// `pnpm build:internal`: `pnpm build` for a company's own copy (docs/SELF-HOSTING.md), with the internal
// defaults from scripts/deployment-env.ts: no share links made, no AI tools, new diagrams Private. Opening links
// people send, the on-device model and every export stay on. A value set in the shell or a .env file (Vite's
// production files: .env, .env.local, .env.production, .env.production.local) wins over a default, so
//   VITE_BRAND_NAME="Acme Diagrams (internal)" VITE_DISABLE_LINK_OPEN=1 pnpm build:internal
// builds that, and VITE_DISABLE_AI_TOOLS=0 (in the shell or .env.local) keeps the AI tools.
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
// The build's environment, taken before Vite loads anything: loading sets NODE_ENV=development in this process,
// which would make the build a development one (and the private-example guard in vite.config.ts stop it).
const env = { ...process.env };
const { INTERNAL_DEFAULTS, readDeployment, resolveDeploymentEnv } = (
  await runnerImport(path.join(root, "scripts/deployment-env.ts"), { root, configFile: false, logLevel: "error" })
).module;

// What the build will see: the shell, then the .env files, then the internal defaults. The child gets exactly
// that, so the build and this summary agree.
const resolved = resolveDeploymentEnv("production", root, INTERNAL_DEFAULTS);
Object.assign(env, resolved);

const d = readDeployment(resolved);
const on = (yes) => (yes ? "on" : "off");
console.log(
  [
    `build:internal: "${d.brandName}"`,
    `  share links ${on(d.shareLinks)}, opening links ${on(d.linkOpen)}, AI tools ${on(d.aiTools)},`,
    `  on-device model ${on(d.onDevice)}, new diagrams private ${on(d.privateByDefault)}`,
    `  (${Object.entries(resolved)
      .map(([k, v]) => `${k}=${v}`)
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
