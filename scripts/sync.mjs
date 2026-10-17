import path from "node:path";
import process from "node:process";
import console from "node:console";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
if (process.argv.slice(2).some((arg) => arg !== "--continue")) throw new Error("Usage: pnpm sync [--continue]");
const { sync, gitRunner } = (await runnerImport(path.join(root, "scripts/sync-runner.ts"), { configFile: false }))
  .module;
try {
  await sync(root, gitRunner(root), console.log, process.argv.includes("--continue"));
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
