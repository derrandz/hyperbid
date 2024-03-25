import test, { configure, solo } from "brittle";
import createTestnet from "hyperdht/testnet.js";
import { createDatabase } from "#core/db";
import { createSwarm, getSeed, createDHT } from "#core/utils";
import { wait } from "./testutils.js";
import ram from "random-access-memory";

test("database instantiates successfully", async (t) => {
  let db = null;
  const key = get32ByteKey().toString("hex");

  await t.execution(() => {
    db = createDB(key, "writer");
  }, "database instantiated successfully");

  t.not(db, null, "database is properly instantiated");
  t.not(db.swarm, null, "database.swarm properly initialized");
  t.not(db.bee, null, "hyperbee properly initialized");
  t.not(db.store, null, "corestore roperly initialized");
  t.not(db.core, null, "hypercore properly initialized");
  t.is(db.mode, "writer", "database mode is writer");
});

test("database starts and stops successfully", async (t) => {
  const key = get32ByteKey().toString("hex");

  const db = await createDB(key, "writer");

  await t.execution(async () => {
    await db.start();
  }, "db started successfully");

  t.not(db.keys.discoveryKey, null, "db started successfully and retrieved keys");

  await t.execution(async () => await db.stop(), "db stopped successfully");

  t.is(db.keys.discoveryKey, null, "db stopped successfully and retrieved keys");
  t.is(db.keys.coreKey, null, "db stopped successfully and retrieved keys");
});

test("database syncs/replicates successfully", async (t) => {
  const maindb = createDB(null, "writer");
  await maindb.start();
  await maindb.sync();

  await wait(500);

  t.not(maindb.keys.coreKey, null, "db is syncing properly");

  console.log("main", {
    discoveryKey: maindb.keys.discoveryKey.toString("hex"),
    coreKey: maindb.keys.coreKey.toString("hex"),
  });

  const replica = createDB(maindb.keys.coreKey, "writer");
  await replica.start();
  await replica.sync();

  await wait(500);

  console.log("replica", {
    discoveryKey: replica.keys.discoveryKey.toString("hex"),
    coreKey: replica.keys.coreKey.toString("hex"),
  });

  // failing: says that session is not writable, weird
  await maindb.bee.put(
    "item",
    Buffer.from(
      JSON.stringify({
        id: 1,
      }),
    ),
  );

  await wait(500);

  const response = await replica.bee.get("item");
  const key = response.key;
  const item = JSON.parse(response.value.toString());

  t.is(key, "item", "replica has item from maindb");
  t.is(item.id, 1, "replica has item from maindb");
});

function createDB(nameOrKey, mode) {
  const swarm = createSwarm();
  const db = createDatabase(swarm, ram, nameOrKey, {
    hyperbee: {
      keyEncoding: "utf-8",
      // valueEncoding: "utf-8",
    },
    core: {
      overwrite: true,
      writable: true,
    },
    mode,
  });

  return db;
}

function get32ByteKey() {
  return Buffer.alloc(32).fill(Math.floor(Math.random() * 256));
}
