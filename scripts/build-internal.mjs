// `pnpm build:internal`: `pnpm build` for a company's own copy (docs/SELF-HOSTING.md), with the internal
// defaults from scripts/deployment-env.ts: no share links made, no AI tools, new diagrams Private. Opening links
// people send, the on-device model and every export stay on. Any variable already set wins, so
//   VITE_BRAND_NAME="Acme Diagrams (internal)" VITE_DISABLE_LINK_OPEN=1 pnpm build:internal
// builds that, and VITE_DISABLE_AI_TOOLS=0 pnpm build:internal keeps the AI tools.
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
// The build's environment, taken before Vite loads anything: loading sets NODE_ENV=development in this process,
// which would make the build a development one (and the private-example guard in vite.config.ts stop it).
const env = { ...process.env };
const { INTERNAL_DEFAULTS, DEPLOYMENT_SWITCHES, readDeployment } = (
  await runnerImport(path.join(root, "scripts/deployment-env.ts"), { root, configFile: false, logLevel: "error" })
).module;

for (const [key, value] of Object.entries(INTERNAL_DEFAULTS)) if (env[key] === undefined) env[key] = value;

const d = readDeployment(env);
const on = (yes) => (yes ? "on" : "off");
console.log(
  [
    `build:internal: "${d.brandName}"`,
    `  share links ${on(d.shareLinks)}, opening links ${on(d.linkOpen)}, AI tools ${on(d.aiTools)},`,
    `  on-device model ${on(d.onDevice)}, new diagrams private ${on(d.privateByDefault)}`,
    `  (${DEPLOYMENT_SWITCHES.filter((k) => env[k] !== undefined)
      .map((k) => `${k}=${env[k]}`)
      .join(" ")})`,
  ].join("\n"),
);

const run = spawnSync("pnpm", ["run", "build"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (run.status === 0)
  console.log(
    "build:internal: done. Serve dist/ behind your sign-in; headers: deploy/self-host/ or pnpm headers:self-host.",
  );
process.exit(run.status ?? 1);
