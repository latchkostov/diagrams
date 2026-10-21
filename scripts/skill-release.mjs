// Refresh committed viewer assets; plugin updates track commits (docs/PARALLEL-WORK.md).
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const unknown = args.filter((a) => !["--check"].includes(a));
if (unknown.length) {
  console.error(`Unknown option ${unknown[0]}. Usage: node scripts/skill-release.mjs [--check]`);
  process.exit(2);
}

const load = async (file) =>
  (await runnerImport(path.join(root, file), { root, configFile: false, logLevel: "error" })).module;
const { checkRepositoryTextEncoding } = await load("scripts/text-encoding.ts");
checkRepositoryTextEncoding(root);
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
    const message = `The agent skill's committed viewer differs from a fresh build (${stale.join(", ")}). Claude Code users get the committed copy; the site's /skill/ download is current. Run pnpm regen to refresh committed generated files.`;
    console.log(`warning: ${message}`);
    // A warning on the workflow run and a line in its summary, never a failure.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Skill viewer is stale::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Skill viewer\n\n${message}\n`);
  }
  process.exit(0);
}

if (!stale.length) {
  console.log("skill:release: the committed viewer is already current; nothing to refresh.");
  process.exit(0);
}
// Stage every asset first and roll back a failed swap.
viewer.applyRelease(Object.fromEntries(stale.map((rel) => [path.join(skill, rel), fresh[rel]])));
for (const rel of stale) console.log(`wrote ${SKILL_DIR}/${rel} (${kB(fresh[rel])})`);
console.log("Skill assets refreshed. Commit these files; plugin updates track commits (docs/PARALLEL-WORK.md).");
