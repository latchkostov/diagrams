// Writes the security headers for a self-hosted copy (docs/SELF-HOSTING.md): an nginx snippet and a `_headers`
// file, from scripts/self-host-headers.ts.
//
//   pnpm headers:self-host                                    # embeds framed by this site only
//   pnpm headers:self-host --frame-ancestors "https://wiki.example.com https://*.example.com"
//   pnpm headers:self-host --providers                        # a build with cloud storage variables set
//   pnpm headers:self-host --out some/dir                     # default: self-host-headers/
//
// Edit together follows the build's own variables (the shell's, then the .env files, as the build reads them): with
// public mode the app's connect-src allows its trackers; server mode allows only its configured relay origin.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { parseArgs } from "node:util";
import { runnerImport } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    "frame-ancestors": { type: "string", default: "" },
    "collab-server": { type: "string" },
    providers: { type: "boolean", default: false },
    out: { type: "string", default: "self-host-headers" },
    base: { type: "string", default: "/" },
  },
});
const { nginxHeaders, headersFile, selfHostHeaderManifest, collabTrackers } = (
  await runnerImport(path.join(root, "scripts/self-host-headers.ts"), { root, configFile: false, logLevel: "error" })
).module;
const { hostingTemplates } = (
  await runnerImport(path.join(root, "scripts/self-host-templates.ts"), { root, configFile: false, logLevel: "error" })
).module;

const { resolveDeploymentEnv } = (
  await runnerImport(path.join(root, "scripts/deployment-env.ts"), { root, configFile: false, logLevel: "error" })
).module;

let files;
try {
  const options = {
    frameAncestors: values["frame-ancestors"].split(/[\s,]+/).filter(Boolean),
    providers: values.providers,
    base: values.base,
    collab: values["collab-server"] ? [] : collabTrackers(resolveDeploymentEnv("production", root)),
    collabServer: values["collab-server"],
  };
  files = {
    "nginx.conf": nginxHeaders(options),
    _headers: headersFile(options),
    "headers.json": `${JSON.stringify(selfHostHeaderManifest(options), null, 2)}\n`,
    ...hostingTemplates(options),
  };
} catch (err) {
  console.error(`headers:self-host: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });
for (const [name, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
  fs.writeFileSync(path.join(out, name), text);
}
console.log(
  `headers:self-host: wrote ${Object.keys(files).join(" and ")} to ${path.relative(process.cwd(), out) || "."}`,
);
process.exit(0);
