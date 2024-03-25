import test, { configure, solo } from "brittle";
import createTestnet from "hyperdht/testnet.js";
import { createPeer } from "#core/peer";
import { getSeed, createRPC, createDHT } from "#core/utils";
import { wait } from "./testutils.js";

configure({
  timeout: 3 * 60 * 1000, // 3 minutes
});

test("peer instantiates successfully", async (t) => {
  let peer = null;
  const { bootstrap } = createTestnet(1);

  await t.execution(async () => {
    peer = await createPeer({
      port: 50001,
      bootstrap,
    }).catch(console.error);
  });

  t.not(peer, null, "peer is properly instantiated");
  t.not(peer.dht, null, "peer.dht properly initialized");
  t.not(peer.swarm, null, "peer.swarm properly initialized");
  t.not(peer.rpc, null, "peer.rpc properly initialized");
  // t.is(peer.db, null);
});

test("peer starts and stops successfully", async (t) => {
  const logs = [];
  const log = (...args) => {
    logs.push(args.join(" "));
  };

  const { bootstrap } = createTestnet(1);
  const peer = await createPeer(
    {
      port: 50001,
      bootstrap,
    },
    {
      log,
    },
  );

  await t.execution(async () => {
    await peer.start();
  }, "peer started successfully");

  t.is(logs.length, 1, "peer started successfully");
  t.ok(logs[0].includes("peer started successfully"), "peer started successfully");

  await t.execution(async () => {
    await peer.stop();
  }, "peer stopped successfully");

  t.is(logs.length, 2, "peer stopped successfully");
  t.ok(logs[1].includes("peer stopped successfully"), "peer stopped successfully");
});

test("peer joins topic and receives events from topic successfully", async (t) => {
  const { bootstrap } = createTestnet(1);
  const { client: rpcClient, cleanUp: cleanUpRPCClient } = await createRPCClient({ port: 33333, bootstrap });
  const peer = await createPeer({
    port: 50001,
    bootstrap,
  });

  await peer.start();

  await peer.listen("room1", (msg) => {
    t.alike(
      msg,
      {
        type: "message",
        payload: {
          text: "hello room!",
        },
      },
      "peer received message from topic=room1 successfully",
    );
    t.pass("peer received message from topic=room1 successfully");
  });

  const payload = Buffer.from(
    JSON.stringify({
      type: "message",
      payload: {
        text: "hello room!",
      },
    }),
    "utf8",
  );
  const resp = await rpcClient.request(peer.publicKey(), "room1", payload);

  t.alike(
    JSON.parse(resp.toString("utf8")),
    {
      status: "OK",
    },
    "broadcast topic rpc request to peer was successful",
  );

  await peer.leave("room1");
  await peer.stop();
  await cleanUpRPCClient();
});

// can be flaky
test("peer joins topic and broadcasts events to topic successfully", async (t) => {
  t.comment("This test can be flaky, thus sometimes fails as though broadcast is not working. It is working though.");
  const testnet = await createTestnet(1);
  const [peer1, peer2, peer3] = await createPeers(3, { bootstrap: testnet.bootstrap });

  await Promise.all([peer1, peer2, peer3].map(async (peer) => await peer.start()));
  await Promise.all(
    [peer1, peer2, peer3].map(async (peer, i) => {
      await peer.listen("room1", (msg) => {
        t.alike(msg, {
          type: "message",
          payload: {
            text: "hello room!",
          },
        });
        t.pass("peer" + i + " received message from topic=room1 successfully");
      });
      await wait(1000);
    }),
  );

  await wait(3500); // give some time for the swarm to "flush"

  const event = {
    type: "message",
    payload: {
      text: "hello room!",
    },
  };

  const resp = await peer1.broadcast("room1", event);
  const expected = {
    results: [
      {
        rpcAddress: peer2.publicKey().toString("hex"),
        swarmAddress: peer2.swarmPublicKey().toString("hex"),
        status: "OK",
      },
      {
        rpcAddress: peer3.publicKey().toString("hex"),
        swarmAddress: peer3.swarmPublicKey().toString("hex"),
        status: "OK",
      },
    ],
    status: "OK",
  };

  t.ok(resp.status == expected.status, "broadcast status is OK");
  t.ok(resp.results.length == expected.results.length, "broadcast results length is equal");
  for (let result of expected.results) {
    t.ok(
      resp.results.find(
        (r) => r.swarmAddress == result.swarmAddress && r.rpcAddress == result.rpcAddress && r.status == result.status,
      ) !== undefined,
      "expected broadcast result not found in response",
    );
  }

  await Promise.all([peer1, peer2, peer3].map(async (peer) => await peer.stop()));
});

async function createRPCClient({ port, bootstrap }) {
  const seed = getSeed();
  const dht = await createDHT({ seed, port, bootstrap });
  const client = createRPC(seed, dht);

  return {
    client,
    cleanUp: async () => {
      await client.destroy();
      await dht.destroy();
    },
  };
}

async function createPeers(count, { bootstrap }) {
  const peers = [];

  for (let i = 0; i < count; i++) {
    const peer = await createPeer({
      port: 50001 + i,
      bootstrap,
      topics: ["room1", "room2"],
    });
    peers.push(peer);
  }

  return peers;
}
