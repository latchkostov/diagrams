import process from "node:process";
import console from "node:console";
import path from "node:path";
import { parseArgs } from "node:util";
import { runnerImport } from "vite";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "frame-ancestors": { type: "string", default: "" },
    providers: { type: "boolean", default: false },
    flat: { type: "boolean", default: false },
  },
});
if (positionals.length !== 1)
  throw new Error("Usage: pnpm self-host:verify <url> [--frame-ancestors <origins>] [--flat] [--providers]");
const root = path.resolve(import.meta.dirname, "..");
const { verifyInstance } = (
  await runnerImport(path.join(root, "scripts/self-host-verify.ts"), { root, configFile: false, logLevel: "error" })
).module;
const problems = await verifyInstance(positionals[0], {
  frameAncestors: values["frame-ancestors"].split(/[\s,]+/).filter(Boolean),
  providers: values.providers,
  flat: values.flat,
  cookie: process.env.SELF_HOST_VERIFY_COOKIE,
});
for (const problem of problems) console.error(`FAIL ${problem}`);
console.log(
  problems.length
    ? `${problems.length} problem(s) found.`
    : "PASS app, embed, module-script and auth-page security headers.",
);
process.exit(problems.length ? 1 : 0);
