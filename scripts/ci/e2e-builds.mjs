// The CI producer builds every served variant once; consumers only verify and serve it.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import console from "node:console";
import { buildE2E } from "../e2e-build.mjs";
import { E2E_PROFILES, selfHostProfiles } from "../e2e-profiles.mjs";
import { shardFiles } from "../e2e-shard.mjs";
import { imageName } from "../gate/doctor.mjs";

export function requiredProfiles(target, specs) {
  if (target !== "build" && target !== "dev") throw new Error(`Unknown E2E target: ${target}`);
  return [...(target === "build" ? ["e2e"] : []), "preview", ...selfHostProfiles(specs)];
}

export async function buildArtifacts(specs, build = buildE2E) {
  const results = await Promise.all(requiredProfiles("build", specs).map(async (name) => [name, await build(name)]));
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
  if (mode === "build") await buildArtifacts(shardFiles(1, 1));
  else if (mode === "check") verifyArtifacts(target, specs);
  else if (mode === "image") console.log(`playwright-image=${imageName(process.cwd())}`);
  else throw new Error("Usage: e2e-builds.mjs build | image | check <build|dev> <specs...>");
}
