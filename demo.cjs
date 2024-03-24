"use strict";

const RPC = require("@hyperswarm/rpc");
const DHT = require("hyperdht");
const Hypercore = require("hypercore");
const Hyperbee = require("hyperbee");
const crypto = require("crypto");

function Server() {
  const main = async () => {
    // hyperbee db
    const hcore = new Hypercore("./db/rpc-server");
    const hbee = new Hyperbee(hcore, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });
    await hbee.ready();

    // resolved distributed hash table seed for key pair
    let dhtSeed = (await hbee.get("dht-seed"))?.value;
    if (!dhtSeed) {
      // not found, generate and store in db
      dhtSeed = crypto.randomBytes(32);
      await hbee.put("dht-seed", dhtSeed);
    }

    // start distributed hash table, it is used for rpc service discovery
    const keyPair = DHT.keyPair(dhtSeed);
    const dht = new DHT({
      port: 40001,
      keyPair,
      bootstrap: [{ host: "127.0.0.1", port: 30001 }], // note boostrap points to dht that is started via cli
    });
    await dht.ready();

    // resolve rpc server seed for key pair
    let rpcSeed = (await hbee.get("rpc-seed"))?.value;
    if (!rpcSeed) {
      rpcSeed = crypto.randomBytes(32);
      await hbee.put("rpc-seed", rpcSeed);
    }

    // setup rpc server
    const rpc = new RPC({ seed: rpcSeed, dht });
    const rpcServer = rpc.createServer();
    await rpcServer.listen();
    console.log("rpc server started listening on public key:", rpcServer.publicKey.toString("hex"));
    // rpc server started listening on public key: 763cdd329d29dc35326865c4fa9bd33a45fdc2d8d2564b11978ca0d022a44a19

    console.log("dht pubkey", keyPair.publicKey.toString("hex"), "rpc pubkey", rpcServer.publicKey.toString("hex"));
    rpcServer.on("connection", (conn) => {
      console.log("new connection", conn);
    });

    console.log(keyPair);
    const stream = dht.announce(Buffer.alloc(32).fill("auction"), keyPair);
    for await (const data of stream) {
      console.log(data);
    }

    // bind handlers to rpc server
    rpcServer.respond("ping", async (reqRaw) => {
      // reqRaw is Buffer, we need to parse it
      const req = JSON.parse(reqRaw.toString("utf-8"));

      const resp = { nonce: req.nonce + 1 };

      // we also need to return buffer response
      const respRaw = Buffer.from(JSON.stringify(resp), "utf-8");
      return respRaw;
    });
  };

  main().catch(console.error);
}

function Client() {
  const RPC = require("@hyperswarm/rpc");
  const DHT = require("hyperdht");
  const Hypercore = require("hypercore");
  const Hyperbee = require("hyperbee");
  const crypto = require("crypto");

  const main = async () => {
    const connectTo = process.argv[2]; // pass server public key as argument
    // hyperbee db
    const hcore = new Hypercore("./db/rpc-client");
    const hbee = new Hyperbee(hcore, {
      keyEncoding: "utf-8",
      valueEncoding: "binary",
    });
    await hbee.ready();

    // resolved distributed hash table seed for key pair
    let dhtSeed = (await hbee.get("dht-seed"))?.value;
    if (!dhtSeed) {
      // not found, generate and store in db
      dhtSeed = crypto.randomBytes(32);
      await hbee.put("dht-seed", dhtSeed);
    }

    // start distributed hash table, it is used for rpc service discovery
    const dht = new DHT({
      port: 50001,
      keyPair: DHT.keyPair(dhtSeed),
      bootstrap: [{ host: "127.0.0.1", port: 30001 }], // note boostrap points to dht that is started via cli
    });
    await dht.ready();

    // public key of rpc server, used instead of address, the address is discovered via dht
    const serverPubKey = connectTo
      ? Buffer.from(connectTo, "hex")
      : Buffer.from("763cdd329d29dc35326865c4fa9bd33a45fdc2d8d2564b11978ca0d022a44a19", "hex");

    const topic = Buffer.alloc(32).fill("auction");
    const stream = dht.lookup(topic, connectTo.toString("hex"));

    for await (const data of stream) {
      console.log(data);
      for (const peer of data.peers) {
        console.log("peer:", peer.publicKey.toString("hex"));
      }
    }

    // rpc lib
    const rpc = new RPC({ dht });

    // payload for request
    const payload = { nonce: 126 };
    const payloadRaw = Buffer.from(JSON.stringify(payload), "utf-8");

    // sending request and handling response
    // see console output on server code for public key as this changes on different instances
    //const respRaw = await rpc.request(serverPubKey, "ping", payloadRaw);
    //const resp = JSON.parse(respRaw.toString("utf-8"));
    //console.log(resp); // { nonce: 127 }

    // closing connection

    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 7000));
      break;
    }
    await rpc.destroy();
    await dht.destroy();
  };

  main().catch(console.error);
}

console.log(process.argv);
if (process.argv[2] === "server") {
  Server();
} else {
  Client();
}

function streamToString(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", (err) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
