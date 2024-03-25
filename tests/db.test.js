import test, { configure, solo } from "brittle";
import createTestnet from "hyperdht/testnet.js";
import { createDatabase } from "#core/db";
import { createSwarm, getSeed, createDHT } from "#core/utils";
import { wait } from "./testutils.js";
import ram from "random-access-memory";

test("database instantiates successfully", async (t) => {
  let db = null;
  const {
    nodes: [dht],
  } = await createTestnet(1);
  const key = get32ByteKey().toString("hex");

  t.execution(() => {
    try {
      db = createDB(dht, key, "writer");
    } catch (e) {
      console.error(e);
    }
  }, "database instantiated successfully");

  t.not(db, null, "database is properly instantiated");
  t.not(db.swarm, null, "database.swarm properly initialized");
  t.not(db.bee, null, "hyperbee properly initialized");
  t.not(db.store, null, "corestore roperly initialized");
  t.not(db.core, null, "hypercore properly initialized");
  t.is(db.mode, "writer", "database mode is writer");
});

test("database starts and stops successfully", async (t) => {
  const { bootstrap } = await createTestnet(1);
  const key = get32ByteKey().toString("hex");

  const db = await createDB(key, "writer", {
    port: 49771,
    bootstrap,
  });

  await t.execution(async () => {
    await db.start();
  }, "db started successfully");

  t.not(db.keys.discoveryKey, null, "db started successfully and retrieved keys");

  await t.execution(async () => await db.stop(), "db stopped successfully");

  t.is(db.keys.discoveryKey, null, "db stopped successfully and retrieved keys");
  t.is(db.keys.coreKey, null, "db stopped successfully and retrieved keys");
});

test("database syncs/replicates successfully", async (t) => {
  const { bootstrap } = await createTestnet(1);
  const key = get32ByteKey().toString("hex");

  const maindb = await createDB(null, "writer", {
    port: 49772,
    bootstrap,
  });
  await maindb.start();
  await maindb.sync();
  t.not(maindb.keys.coreKey, null, "db is syncing properly");

  console.log("main", {
    discoveryKey: maindb.keys.discoveryKey.toString("hex"),
    coreKey: maindb.keys.coreKey.toString("hex"),
  });
  const replica = await createDB(maindb.keys.coreKey, "reader", {
    port: 49773,
    bootstrap,
  });
  await replica.start();
  await replica.sync();

  console.log("replica", {
    discoveryKey: replica.keys.discoveryKey.toString("hex"),
    coreKey: replica.keys.coreKey.toString("hex"),
  });

  // failing: says that session is not writable, weird
  await maindb.bee.put("item", {
    id: 1,
  });

  await wait(1000);

  const item = await replica.bee.get("item");
  console.log({ item });
});

async function createDB(nameOrKey, mode, { port, bootstrap }) {
  const seed = getSeed();
  const dht = await createDHT({ port, seed, bootstrap });
  const swarm = createSwarm(seed, dht);
  const db = createDatabase(swarm, ram, nameOrKey, {
    hyperbee: {
      keyEncoding: "utf-8",
      valueEncoding: "utf-8",
    },
    core: {
      overwrite: true,
    },
    mode,
  });

  return db;
}

function get32ByteKey() {
  return Buffer.alloc(32).fill(Math.floor(Math.random() * 256));
}
