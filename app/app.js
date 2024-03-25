class App {
  construct({ port, bootstrap }) {
    this.peer = null;
    this.config = {
      port,
      bootstrap,
    };
  }

  async init() {
    peer = await createPeer(this.config);

    await peer.listen("auctions", (msg) => {});
    await peer.listen("bids", (msg) => {});

    await peer.respond("height", () => {
      return peer.db.height();
    });

    await peer.respond("sync", () => {
      return peer.db.address();
    });
  }

  async start() {
    await peer.start();
    await peer.syncState();

    // start syncing the app state
    await this.syncState();
  }

  async stop() {
    await peer.stop();
  }

  // TODO: incomplete
  async syncState() {
    const response = await Promise.all(
      Array.from(this.peer.rpcPeers, ([_, rpcAddress]) => rpcAddress).map(async (address) => {
        const resp = await this.peer.request(address, "sync", {});
        return {
          address,
          height: resp.height,
        };
      }),
    );

    const latestHeightResp = response.reduce((acc, curr) => (acc.height > curr.height ? acc : curr), { height: 0 });

    // retrieve the db address (for replication) from the peer with the latest height by requesting sync
    // then create new db and sync it with the db address
    // snapshot and batch insert into own db
    // remove replicated db
  }
}
