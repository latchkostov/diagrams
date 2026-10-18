import { createRelayServer } from "./http";
import { createLog } from "./log";

const log = createLog();
try {
  const relay = createRelayServer({ log });
  await relay.listen();
  log("listening");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      // A blocked stdout consumer must not extend the connection-drain deadline.
      void relay.shutdown().then(() => process.exit(0));
    });
} catch {
  log("startup-error");
  process.exitCode = 1;
}
