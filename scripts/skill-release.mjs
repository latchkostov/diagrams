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
const { LITE_DIR, generateLiteFiles } = await load("scripts/skill-lite.ts");
const lite = generateLiteFiles(root);
const liteRoot = path.join(root, LITE_DIR);
const listLite = (dir, rel = "") =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const name = rel ? `${rel}/${entry.name}` : entry.name;
        return entry.isDirectory() ? listLite(path.join(dir, entry.name), name) : [name];
      })
    : [];
const unexpected = listLite(liteRoot).filter((rel) => !Object.hasOwn(lite, rel));
if (unexpected.length) {
  console.error(`Unexpected lite plugin files: ${unexpected.join(", ")}. Remove them before releasing.`);
  process.exit(1);
}
const liteStale = Object.keys(lite).filter((rel) => {
  const file = path.join(root, LITE_DIR, rel);
  return !fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.from(lite[rel]));
});
if (check && liteStale.length) {
  console.error(`lite plugin is stale: ${liteStale.join(", ")}. Run pnpm regen.`);
  process.exit(1);
}
if (!check) {
  for (const rel of liteStale) {
    const file = path.join(root, LITE_DIR, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lite[rel]);
  }
  console.log(`lite plugin: ${liteStale.length} files refreshed.`);
}

const skill = path.join(root, SKILL_DIR);
const read = (rel) => {
  const file = path.join(skill, rel);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
};
const fresh = {
  ...viewer.releasedFiles(root, await buildViewerTemplate(root)),
  [viewer.INJECT]: await viewer.injectModule(root),
};
const obsolete = fs
  .readdirSync(path.join(skill, "scripts/lib"))
  .map((name) => `scripts/lib/${name}`)
  .filter((name) => viewer.isReleased(name) && !Object.hasOwn(fresh, name));
const stale = Object.keys(fresh).filter((rel) => !read(rel)?.equals(Buffer.from(fresh[rel])));
const kB = (text) => `${Math.round(Buffer.byteLength(text) / 1000).toLocaleString("en-US")} kB`;

if (check) {
  if (!stale.length && !obsolete.length) console.log("skill viewer: the committed copy matches a fresh build.");
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

if (!stale.length && !obsolete.length) {
  console.log("skill:release: the committed viewer is already current; nothing to refresh.");
  process.exit(0);
}
// Stage every asset first and roll back a failed swap.
viewer.applyRelease(Object.fromEntries(stale.map((rel) => [path.join(skill, rel), fresh[rel]])));
for (const rel of obsolete) fs.rmSync(path.join(skill, rel));
for (const rel of stale) console.log(`wrote ${SKILL_DIR}/${rel} (${kB(fresh[rel])})`);
console.log("Skill assets refreshed. Commit these files; plugin updates track commits (docs/PARALLEL-WORK.md).");
