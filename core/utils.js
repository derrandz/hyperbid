import Hyperswarm from "hyperswarm";
import HyperRPC from "@hyperswarm/rpc";
import HyperDHT from "hyperdht";
import Hypercore from "hypercore";
import Hyperbee from "hyperbee";
import crypto from "crypto";

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

async function createDb(path) {
  const hcore = new Hypercore(path);
  const db = new Hyperbee(hcore, {
    keyEncoding: "utf-8",
    valueEncoding: "binary",
  });
  await db.ready();
  return db;
}

function getSeed(len = 32) {
  return crypto.randomBytes(len);
}

function to32ByteBuffer(str) {
  return Buffer.alloc(32).fill(str);
}

export { createDHT, createSwarm, createRPC, createDb, getSeed, to32ByteBuffer };
