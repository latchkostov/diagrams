// `pnpm skill:release [--minor]`: refreshes the agent skill's committed Interactive HTML viewer
// (skills/livediagrams/scripts/lib/viewer-template.html and icons.json) from a fresh build, regenerates
// inject.mjs, and bumps the plugin's version in .claude-plugin/marketplace.json (patch by default), so Claude Code
// users get the latest viewer. Run it when you want them to; nothing else rewrites those files (see
// scripts/skill-viewer.ts). Commit what it changes.
//
// `pnpm skill:check`: reports whether the committed viewer differs from a fresh build. Informational only: it
// exits 0 either way (the nightly workflow runs it), and 1 only if the build itself fails.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const kind = args.includes("--minor") ? "minor" : "patch";
const force = args.includes("--force");
const unknown = args.filter((a) => !["--check", "--minor", "--force"].includes(a));
if (unknown.length) {
  console.error(`Unknown option ${unknown[0]}. Usage: node scripts/skill-release.mjs [--check | --minor | --force]`);
  process.exit(2);
}

const load = async (file) =>
  (await runnerImport(path.join(root, file), { root, configFile: false, logLevel: "error" })).module;
const viewer = await load("scripts/skill-viewer.ts");
const { buildViewerTemplate } = await load("scripts/interactive-viewer.ts");
const { SKILL_DIR } = await load("scripts/skill-gen.ts");

const skill = path.join(root, SKILL_DIR);
const read = (rel) => {
  const file = path.join(skill, rel);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
};
const fresh = {
  ...viewer.releasedFiles(root, await buildViewerTemplate(root)),
  [viewer.INJECT]: await viewer.injectModule(root),
};
const stale = Object.keys(fresh).filter((rel) => read(rel) !== fresh[rel]);
const kB = (text) => `${Math.round(Buffer.byteLength(text) / 1000).toLocaleString("en-US")} kB`;

if (check) {
  if (!stale.length) console.log("skill viewer: the committed copy matches a fresh build.");
  else {
    const message = `The agent skill's committed viewer differs from a fresh build (${stale.join(", ")}). Claude Code users get the committed copy; the site's /skill/ download is current. Run pnpm skill:release when you want them to get the latest viewer.`;
    console.log(`warning: ${message}`);
    // A warning on the workflow run and a line in its summary, never a failure.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Skill viewer is stale::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Skill viewer\n\n${message}\n`);
  }
  process.exit(0);
}

if (!stale.length && !force) {
  console.log("skill:release: the committed viewer is already current; nothing to release (--force bumps anyway).");
  process.exit(0);
}
for (const rel of stale) fs.writeFileSync(path.join(skill, rel), fresh[rel]);
const manifest = path.join(root, ".claude-plugin", "marketplace.json");
const bumped = viewer.bumpVersion(fs.readFileSync(manifest, "utf8"), kind);
fs.writeFileSync(manifest, bumped.text);
for (const rel of stale) console.log(`wrote ${SKILL_DIR}/${rel} (${kB(fresh[rel])})`);
console.log(`livediagrams plugin ${bumped.from} → ${bumped.to} (.claude-plugin/marketplace.json). Commit these files.`);
