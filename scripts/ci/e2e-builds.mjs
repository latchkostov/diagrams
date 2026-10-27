// The CI producer builds every served variant once; consumers only verify and serve it.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { buildE2E } from "../e2e-build.mjs";
import { E2E_PROFILES, requiredProfiles } from "../e2e-profiles.mjs";
import { shardFiles } from "../e2e-shard.mjs";
import { imageName } from "../gate/doctor.mjs";

export { requiredProfiles };

export async function buildArtifacts(specs, build = buildE2E, target = "build") {
  const results = await Promise.all(requiredProfiles(target, specs).map(async (name) => [name, await build(name)]));
  const failed = results.filter(([, code]) => code !== 0).map(([name]) => name);
  if (failed.length) throw new Error(`E2E builds failed: ${failed.join(", ")}`);
}

export function verifyArtifacts(target, specs, root = process.cwd()) {
  for (const name of requiredProfiles(target, specs)) {
    const file = join(root, E2E_PROFILES[name].outDir, "index.html");
    if (!existsSync(file)) throw new Error(`Missing prebuilt ${name}: ${file}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, target, ...specs] = process.argv.slice(2);
  if (mode === "build") await buildArtifacts(target ? specs : shardFiles(1, 1), buildE2E, target ?? "build");
  else if (mode === "check") verifyArtifacts(target, specs);
  else if (mode === "image") console.log(`playwright-image=${imageName(process.cwd())}`);
  else throw new Error("Usage: e2e-builds.mjs build [<build|dev> <specs...>] | image | check <build|dev> <specs...>");
}
