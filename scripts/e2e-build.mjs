import process from "node:process";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { e2eBuild } from "./e2e-profiles.mjs";
import { command } from "./gate/commands.mjs";

export async function buildE2E(name, execute = command) {
  const { args, env } = e2eBuild(name);
  // CI invokes this directly, so neither a pnpm wrapper nor Corepack is required here.
  const vite = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  return (await execute(process.execPath, [vite, ...args.slice(2)], { env, live: true })).code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await buildE2E(process.argv[2]);
