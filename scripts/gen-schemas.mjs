// Writes the static agent docs (public/schema/diagram.v1.json, ops.v1.json, stencils.json) and the
// generated parts of the agent skill (skills/livediagrams/, see scripts/skill-gen.ts) from the code, so
// they never drift from the app. Runs before every build (`prebuild`); run it by hand with
// `pnpm schemas`. The sources are src/ai/webmcp/publicSchemas.ts and scripts/skill-gen.ts, loaded
// through Vite so TypeScript and the app's imports work unchanged.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const load = async (file) =>
  (await runnerImport(path.join(root, file), { root, configFile: false, logLevel: "error" })).module;

/** Writes each file that changed; returns how many did. */
function writeAll(dir, files) {
  let changed = 0;
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
    if (before === text) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    changed++;
  }
  return changed;
}
const report = (what, changed, total, where) =>
  console.log(`${what}: ${changed ? `wrote ${changed} of` : "unchanged,"} ${total} files in ${where}`);

const files = (await load("src/ai/webmcp/publicSchemas.ts")).publicSchemaFiles();
report("schemas", writeAll(path.join(root, "public", "schema"), files), Object.keys(files).length, "public/schema/");

const skill = await load("scripts/skill-gen.ts");
const skillFiles = await skill.generateSkillFiles(root);
report(
  "skill",
  writeAll(path.join(root, skill.SKILL_DIR), skillFiles),
  Object.keys(skillFiles).length,
  `${skill.SKILL_DIR}/ (generated)`,
);
process.exit(0);
