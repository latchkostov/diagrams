import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { runnerImport } from "vite";

if (process.argv.length !== 3) throw new Error("Usage: pnpm self-host:image <helm-values.yaml>");
const root = path.resolve(import.meta.dirname, "..");
const { imageBuildArgs } = (
  await runnerImport(path.join(root, "scripts/self-host-image.ts"), { root, configFile: false, logLevel: "error" })
).module;
const args = imageBuildArgs(parse(fs.readFileSync(path.resolve(process.argv[2]), "utf8")));
console.log(`Building ${args[2]} from Helm values; no registry push.`);
const build = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
process.exit(build.status ?? 1);
