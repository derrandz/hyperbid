import Hyperswarm from "hyperswarm";
import HyperRPC from "@hyperswarm/rpc";
import HyperDHT from "hyperdht";
import Hyperbee from "hyperbee";
import Hypercore from "hypercore";
import crypto from "crypto";
import b4a from "b4a";

async function createDHT({ port, seed, bootstrap }) {
  if (typeof port === undefined || port === null) {
    throw new Error("port is required");
  }

  let keyPair = undefined;
  if (typeof seed !== undefined && seed !== "" && seed !== null) {
    keyPair = HyperDHT.keyPair(seed);
  }

  const dht = new HyperDHT({
    port,
    keyPair,
    bootstrap,
  });

  await dht.ready();

  return dht;
}

function createSwarm(seed, dht) {
  return new Hyperswarm({
    seed,
    dht,
  });
}

function createRPC(seed, dht) {
  return new HyperRPC({
    seed,
    dht,
  });
}

function createCore(path, dbNameOrKey, opts) {
  const key = dbNameOrKey ? (opts.mode === "writer" ? dbNameOrKey : b4a.from(dbNameOrKey, "hex")) : dbNameOrKey;
  const core = key ? new Hypercore(path, key, opts.core) : new Hypercore(path, opts.core);
  return {
    core,
  };
}

function createDb(core, opts) {
  return new Hyperbee(core, opts);
}

function getSeed(len = 32) {
  return crypto.randomBytes(len);
}

function to32ByteBuffer(str) {
  return Buffer.alloc(32).fill(str);
}

function isNullOrUndefined(value) {
  return value === null || value === undefined;
}

export { createDHT, createSwarm, createRPC, createCore, createDb, getSeed, to32ByteBuffer, isNullOrUndefined };
