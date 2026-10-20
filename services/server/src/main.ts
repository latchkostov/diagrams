import { createRelayServer } from "./http";
import { createLog } from "./log";
import { readConfig } from "./config";
import { healthcheck } from "./healthcheck";
import { MemoryBudgetError } from "./memory";

const log = createLog();
try {
  if (process.argv.includes("--healthcheck")) {
    const { port, host } = readConfig();
    process.exitCode = (await healthcheck(port, host)) ? 0 : 1;
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
} catch (error) {
  log(error instanceof MemoryBudgetError ? "startup-error-buffer-budget" : "startup-error");
  process.exitCode = 1;
}
