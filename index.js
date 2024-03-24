import { createPeer } from "#core/peer";

async function main() {
  const peer = await createPeer({
    port: 50001,
    bootstrap,
    topics: ["room1", "room2"],
  });
}

main().catch(console.error);
