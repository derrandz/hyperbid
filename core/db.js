import { createCore, createDb } from "#core/utils";

class Database {
  constructor(core, bee, swarm, mode) {
    this._validateMode(mode);

    this.core = core;
    this.bee = bee;
    this.swarm = swarm;

    this.keys = {
      discoveryKey: null,
      coreKey: null,
    };

    this.mode = mode;
  }

  _validateMode(mode) {
    if (mode !== "writer" && mode !== "reader") {
      throw new Error("mode must be either 'writer' or 'reader'");
    }
  }

  _replicateStore(conn) {
    console.log("replicating store", conn);
    this.bee.replicate(conn);
  }

  async start() {
    await this.core.ready();
    await this.bee.ready();
    this.keys.discoveryKey = this.core.discoveryKey;
  }

  async sync() {
    await this.swarm
      .join(this.core.discoveryKey)
      .flushed()
      .then(() => {
        console.log("joined");
      });
    await this.swarm.flush();

    this.swarm.on("connection", this._replicateStore.bind(this));

    let markDiscoveryDone = () => {};
    if (this.mode === "reader") {
      markDiscoveryDone = this.core.findingPeers();
    }

    this.keys.coreKey = this.core.key;

    if (this.mode === "reader") {
      markDiscoveryDone();
      await this.core.update();
    }

    console.log("syncing...");
  }

  async stop() {
    await this.swarm.leave(this.core.discoveryKey);
    this.swarm.removeListener("connection", this._replicateStore.bind(this));
    await this.bee.close(); // closes the core as well
    this.keys.discoveryKey = null;
    this.keys.coreKey = null;
  }
}

export function createDatabase(swarm, path, dbNameOrKey, opts) {
  console.log({
    swarm,
    path,
    dbNameOrKey,
  });
  const { core } = createCore(path, dbNameOrKey, {
    core: opts.core,
  });
  const bee = createDb(core, opts.hyperbee || {});

  const db = new Database(core, bee, swarm, opts.mode || "reader");

  return db;
}
