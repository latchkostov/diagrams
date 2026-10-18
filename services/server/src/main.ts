import { createRelayServer } from "./http";
import { createLog } from "./log";

const log = createLog();
const relay = createRelayServer({ log });
await relay.listen();
log("listening");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    relay.drain();
    // S2 adds a bounded graceful drain. S1 stops all sockets and the listener deterministically.
    void relay.close();
  });
