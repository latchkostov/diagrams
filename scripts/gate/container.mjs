// Docker entry point. The host owns locking, preflight, unchanged-HEAD checks and stamps.
import process from "node:process";
import { readdirSync, lchownSync } from "node:fs";
import { join } from "node:path";
import { required } from "./commands.mjs";
import { runSteps } from "./run.mjs";

const { config, changed, directory } = JSON.parse(process.argv[2]);
// Playwright's webServer commands invoke pnpm directly, as CI does.
await required("corepack", ["enable"], { cwd: "/work" });
await required("corepack", ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"], { cwd: "/work" });
try {
  const summary = await runSteps("/work", config, changed, directory, { PARITY_CONTAINER: "1", GATE_CONTAINER: "1" });
  process.exitCode = summary.failures ? 1 : 0;
} finally {
  if (process.env.GATE_OWNER) {
    const [uid, gid] = process.env.GATE_OWNER.split(":").map(Number);
    const own = (path) => {
      for (const item of readdirSync(path, { withFileTypes: true })) {
        const file = join(path, item.name);
        if (item.isDirectory()) own(file);
        lchownSync(file, uid, gid);
      }
      lchownSync(path, uid, gid);
    };
    try {
      own(directory);
    } catch (error) {
      // Some Desktop bind mounts map ownership themselves, as parity's runner does.
      if (!["EPERM", "EACCES"].includes(error.code)) process.exitCode = 1;
      process.stderr.write(`Report ownership is managed by the bind mount: ${error.message}\n`);
    }
  }
}
