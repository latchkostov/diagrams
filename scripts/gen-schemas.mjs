// Writes the generated parts of the agent skill (skills/livediagrams/, see scripts/skill-gen.ts), vercel.json's
// security headers (scripts/security-headers.ts) and the self-hosting samples in deploy/self-host/
// (scripts/self-host-headers.ts) from the code, so they never drift from the app. Runs
// before every build (`prebuild`); run it by hand with `pnpm schemas`. The sources are
// scripts/skill-gen.ts and scripts/security-headers.ts, loaded through
// Vite so TypeScript and the app's imports work unchanged. Public schemas are emitted by schema-assets.ts.
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

const skill = await load("scripts/skill-gen.ts");
const skillFiles = await skill.generateSkillFiles(root);
report(
  "skill",
  writeAll(path.join(root, skill.SKILL_DIR), skillFiles),
  Object.keys(skillFiles).length,
  `${skill.SKILL_DIR}/ (generated)`,
);
// vercel.json: the security headers (scripts/security-headers.ts) for the production site.
const headers = await load("scripts/security-headers.ts");
report("vercel.json", writeAll(root, { "vercel.json": headers.vercelJson() }), 1, "the repository root");
// deploy/self-host/: the same headers for a self-hosted copy (scripts/self-host-headers.ts, docs/SELF-HOSTING.md).
const selfHost = {
  ...(await load("scripts/self-host-headers.ts")).selfHostSamples(),
  ...(await load("scripts/self-host-templates.ts")).hostingTemplates(),
};
report(
  "self-host headers",
  writeAll(path.join(root, "deploy", "self-host"), selfHost),
  Object.keys(selfHost).length,
  "deploy/self-host/",
);

process.exit(0);
