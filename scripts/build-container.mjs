import process from "node:process";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
// Compose passes empty optional args. Treat them as unset so build:internal retains its defaults.
for (const key of Object.keys(env)) if (key.startsWith("VITE_") && env[key] === "") Reflect.deleteProperty(env, key);
const profile = env.BUILD_PROFILE ?? "internal";
if (!["internal", "public"].includes(profile)) throw new Error("BUILD_PROFILE must be internal or public");
const result = spawnSync("pnpm", [profile === "internal" ? "build:internal" : "build"], {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
