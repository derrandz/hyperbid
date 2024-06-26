import { createDHT, createSwarm, createRPC, getSeed, to32ByteBuffer, isNullOrUndefined } from "#core/utils";
import { createDatabase } from "#core/db";
import ram from "random-access-memory";

export async function createPeer({ port, seed, bootstrap }, opts) {
  if (seed === null || typeof seed === undefined || seed === "") {
    seed = getSeed();
  }
  const dht = await createDHT({ port, seed });
  const swarm = createSwarm(seed, dht);
  const rpc = createRPC(seed, dht);
  const dbSwarm = createSwarm(); // create a new swarm for the db to have separate connections for replicating the db
  // TODO: think about using persistent storage for the db later
  const db = createDatabase(dbSwarm, ram, null, {
    hyperbee: {
      keyEncoding: "utf-8",
      // valueEncoding: "utf-8",
    },
    core: {
      overwrite: true,
    },
    mode: "writer", // will deprecate this, it's a bit of a relic from a previous idea
  });

  return new Peer(dht, swarm, rpc, db, opts);
}

function noop() {}

export class Peer {
  constructor(dht, swarm, rpc, db, opts) {
    this.dht = dht;
    this.swarm = swarm;
    this.rpc = rpc;
    this.db = db;
    this.topics = [];
    this.methods = [];
    this.log = noop;
    this.rpcPeers = new Map();

    this._rpcServer = null;

    // TODO: add db stuff here

    if (!isNullOrUndefined(opts)) {
      if (typeof opts.log === "function") {
        this.log = opts.log;
      }
    }
  }

  /*
   * Start starts the peer by starting the rpc server and the swarm.
   * for each new swarm connection, it will exchange rpc metadata
   * and store the public key of the rpc server of the peer
   * to be able to send (pubsub) rpc requests to it.
   */
  async start() {
    this._rpcServer = this.rpc.createServer();
    await this._rpcServer.listen();

    // this process of exchanging rpc metadata is a bit hacky
    // ideally, it should respect stricter protocol logic
    // but this will do for this task for now. (refer to #pubsub-over-hyperprotocol in DESIGN.md)
    const payload = this._rpcMetadataExchangePayload();

    this.swarm.on("connection", (conn) => {
      this.log("got connection from", conn.remotePublicKey.toString("hex"));
      conn.write(payload);
      conn.on("data", (data) => {
        this._handleClientRpcMetadataExchange(conn, data, "open");
      });
      conn.on("close", () => {
        this._handleClientRpcMetadataExchange(conn, null, "close");
      });
      conn.on("error", (e) => console.error("connection error", conn.remotePublicKey.toString("hex"), e));
    });

    await this.db.start();

    this.log("peer started successfully, publicKey=", this.publicKey().toString("hex"));
  }

  async stop() {
    for (let topic of this.topics) {
      const disc = this._getTopicDiscoveryInfo(topic);
      if (!isNullOrUndefined(disc)) {
        await this.leave(topic);
      }
    }

    for (let method of this.methods) {
      await this.unrespond(method);
    }

    this.swarm.removeAllListeners();
    await this._rpcServer.close();
    await this.rpc.destroy();
    await this.dht.destroy();
    await this.db.stop();
    this.log("peer stopped successfully");
  }

  async listen(topic, handler) {
    const topicDisc = this._getTopicDiscoveryInfo(topic);
    if (!isNullOrUndefined(topicDisc)) {
      throw new Error("cannot listen to topic twice, already listening to topic");
    }

    await this._joinSwarmTopic(topic);
    this._handleRPCTopic(topic, handler);
  }

  async _joinSwarmTopic(topic) {
    if (isNullOrUndefined(this.swarm)) {
      throw new Error("malinitialized instance: swarm is not defined");
    }

    const topicDisc = this.swarm.join(to32ByteBuffer(topic));
    await this.swarm.flush();
    await topicDisc.flushed();

    this.topics.push(topic);

    this.log("joined topic:", topic);
  }

  _handleRPCTopic(topic, handler) {
    if (isNullOrUndefined(this._rpcServer)) {
      throw new Error("malinitialized instance: rpc server is not defined");
    }

    this._rpcServer.respond(topic, async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      await handler(req);

      return Buffer.from(
        JSON.stringify({
          // TODO: add peer metadata for info maybe?
          status: "OK",
        }),
        "utf-8",
      );
    });
  }

  async leave(topic) {
    await this._leaveSwarmTopic(topic);
    this._unhandleRPCTopic(topic);
  }

  async _leaveSwarmTopic(topic) {
    const topicDisc = this._getTopicDiscoveryInfo(topic);
    if (isNullOrUndefined(topicDisc)) {
      throw new Error("topic not joined");
    }

    await this.swarm.leave(to32ByteBuffer(topic));
    await topicDisc.destroy();
    this.topics.splice(this.topics.indexOf(topic), 1);
  }

  _unhandleRPCTopic(topic) {
    if (isNullOrUndefined(this._rpcServer)) {
      throw new Error("malinitialized instance: rpc server is not defined");
    }

    this._rpcServer.unrespond(topic);
  }

  async broadcast(topic, event) {
    const topicDisc = this._getTopicDiscoveryInfo(topic);
    if (isNullOrUndefined(topicDisc)) {
      throw new Error("topic not joined");
    }

    const topicPeers = this._getTopicPeerlist(topicDisc);
    if (topicPeers.length === 0) {
      return {
        results: [],
        status: "NO_TOPIC_SWARM_PEERS",
      };
    }

    if (this.rpcPeers.size === 0) {
      return {
        results: [],
        status: "NO_TOPIC_RPC_PEERS",
      };
    }

    const topicPeersAddrs = topicPeers.map((p) => p.publicKey.toString("hex"));

    const peers = [];
    for (let [swarmAddress, rpcAddress] of this.rpcPeers) {
      if (topicPeersAddrs.includes(swarmAddress) > -1) {
        peers.push({
          swarmAddress,
          rpcAddress,
        });
      }
    }

    const results = await this.__requestRPCTopic(topic, event, peers);
    return {
      results: results,
      status: "OK",
    };
  }

  async __requestRPCTopic(topic, event, peers) {
    const payload = Buffer.from(JSON.stringify(event), "utf-8");
    return await Promise.all(
      peers.map(async ({ swarmAddress, rpcAddress }) => {
        try {
          const respRaw = await this.rpc.request(Buffer.from(rpcAddress, "hex"), topic, payload);
          const resp = JSON.parse(respRaw.toString("utf-8"));

          if (isNullOrUndefined(resp) || (resp && resp.status !== "OK")) {
            this.log("error broadcasting to peer", { swarmAddress, rpcAddress });
            return {
              rpcAddress,
              swarmAddress,
              status: "ERROR",
            };
          }

          return {
            rpcAddress,
            swarmAddress,
            status: "OK",
          };
        } catch (e) {
          this.log("error broadcasting to peer", { rpcAddress, swarmAddress }, "error:", e);
          return {
            error: e,
            rpcAddress,
            swarmAddress,
            status: "ERROR",
          };
        }
      }),
    );
  }

  _getTopicPeerlist(topicDiscovery) {
    return Array.from(topicDiscovery.swarm.peers, ([_, peerInfo]) => peerInfo).filter(
      (peerInfo) => peerInfo.topics.find((topic) => topic.equals(topicDiscovery.topic)) !== undefined,
    );
  }

  async respond(method, handler) {
    if (isNullOrUndefined(this._rpcServer)) {
      throw new Error("malinitialized instance: rpc server is not defined");
    }

    if (this.methods.includes(method)) {
      throw new Error("method already registered");
    }

    this._rpcServer.respond(method, async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString("utf-8"));
      const data = await handler(req);

      return Buffer.from(
        JSON.stringify({
          // TODO: add peer metadata for info maybe?
          status: "OK",
          data,
        }),
        "utf-8",
      );
    });

    this.methods.push(method);
  }

  async unrespond(method) {
    if (!this.methods.includes(method)) {
      throw new Error("method not registered");
    }

    await this._rpcServer.unrespond(method);
    this.methods.splice(this.methods.indexOf(method), 1);
  }

  async request(peer, method, data) {
    if (isNullOrUndefined(this._rpcServer)) {
      throw new Error("malinitialized instance: rpc server is not defined");
    }

    const respRaw = await this._rpcServer.request(
      Buffer.from(peer, "hex"),
      method,
      Buffer.from(JSON.stringify(data), "utf-8"),
    );

    return JSON.parse(respRaw.toString("utf-8"));
  }

  async syncState() {
    await this.db.sync();
  }

  /*
   * Returns the current state height
   */
  stateHeight() {
    return this.db.height();
  }

  publicKey() {
    if (!isNullOrUndefined(this._rpcServer)) {
      return this._rpcServer.publicKey;
    }
    return null;
  }

  swarmPublicKey() {
    if (!isNullOrUndefined(this.swarm)) {
      return this.swarm.keyPair.publicKey;
    }
    return null;
  }

  _getTopicDiscoveryInfo(topic) {
    return this.swarm.status(to32ByteBuffer(topic));
  }

  _rpcMetadataExchangePayload() {
    const rpcMetadata = {
      publicKey: this.publicKey().toString("hex"), // to bytes would be better
    };
    const payload = Buffer.from(JSON.stringify(rpcMetadata), "utf-8");
    return payload;
  }

  _handleClientRpcMetadataExchange(conn, data, event) {
    switch (event) {
      case "open":
        const metadata = JSON.parse(data.toString("utf-8"));
        if (metadata.publicKey) {
          this.rpcPeers.set(conn.remotePublicKey.toString("hex"), metadata.publicKey);
        } else {
          console.warn("no public key received, ignoring non pubsub peer");
        }
      case "close":
        // turns out the connection (according to what's seen in the tests) gets closed immediately
        // after joining a topic. So we can't really rely on this event to remove the peer from the topic's list
        // will ignore ftm
        console.log("closing", conn.remotePublicKey.toString("hex"));
    }
  }
}
