import { createRelayServer } from "./http";
import { createLog } from "./log";
import { readConfig } from "./config";
import { healthcheck } from "./healthcheck";

const log = createLog();
try {
  if (process.argv.includes("--healthcheck")) {
    process.exitCode = (await healthcheck(readConfig().port)) ? 0 : 1;
  } else {
    const relay = createRelayServer({ log });
    await relay.listen();
    log("listening");
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        // A blocked stdout consumer must not extend the connection-drain deadline.
        void relay.shutdown().then(() => process.exit(0));
      });
  }
} catch {
  log("startup-error");
  process.exitCode = 1;
}
