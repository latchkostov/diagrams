#!/usr/bin/env node
// Usage: node scripts/export-html.mjs <file.diagram.json> [--out <path>] [--theme light|dark] [--banner "text"]
//                                     [--title "text"] [--sim <id>] [--no-autoplay]
// Writes the diagram as one self-contained interactive HTML file, the same file as the app's
// File > Export as > Interactive HTML…: read-only pan and zoom, and its simulations play. The file works offline,
// makes no network requests (a strict Content-Security-Policy says so) and stores nothing in the browser. Only
// people who have the file can open it. This script makes no network requests either: the viewer, the injection
// and the icons are bundled in ./lib (`pnpm skill:release`). Before writing, it checks the finished payload with
// the viewer's own rules, so it never writes a file the viewer would refuse or show with something missing.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { checkFile } from "./lib/check.mjs";
import { parsePayload } from "./lib/app.mjs";
import { buildPayload, htmlFileName, injectPayload, scriptSafeJson } from "./lib/inject.mjs";

const USAGE =
  'Usage: node scripts/export-html.mjs <file.diagram.json> [--out <path>] [--theme light|dark] [--banner "text"] [--title "text"] [--sim <id>] [--no-autoplay]';
const VALUED = ["--out", "--theme", "--banner", "--title", "--sim", "--exported-on"];
const FLAGS = ["--no-autoplay"];

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

const args = process.argv.slice(2);
const opts = {};
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (VALUED.includes(a)) {
    if (i + 1 >= args.length) fail(`${a} needs a value.\n${USAGE}`);
    opts[a] = args[++i];
  } else if (FLAGS.includes(a)) opts[a] = true;
  else if (a.startsWith("--")) fail(`Unknown option ${a}.\n${USAGE}`);
  else files.push(a);
}
if (files.length !== 1) fail(USAGE);
const [file] = files;
const theme = opts["--theme"] ?? "light";
if (theme !== "light" && theme !== "dark") fail(`--theme must be light or dark, not "${theme}".`);
// For reproducible output (tests): the footer's "Exported on" date.
const exportedOn = opts["--exported-on"];
if (exportedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(exportedOn))
  fail(`--exported-on must be a date like 2026-10-12, not "${exportedOn}".`);

// The same checks as validate.mjs: the viewer opens only what the app would.
const { errors, diagram } = checkFile(file);
if (errors.length) {
  console.error(`${file} has ${errors.length} error${errors.length === 1 ? "" : "s"}; fix them first:`);
  for (const e of errors) console.error(`  error: ${e}`);
  console.error("Run node scripts/validate.mjs <file> for the full report.");
  process.exit(1);
}

const sims = diagram.simulations ?? [];
let start = sims[0]?.id ?? null;
if (opts["--sim"] !== undefined) {
  if (!sims.some((s) => s.id === opts["--sim"]))
    fail(
      `--sim "${opts["--sim"]}" isn't one of this diagram's simulations${sims.length ? ` (${sims.map((s) => s.id).join(", ")})` : " (it has none)"}.`,
      1,
    );
  start = opts["--sim"];
}
if (opts["--no-autoplay"]) start = null;

const lib = new URL("./lib/", import.meta.url);
const template = readFileSync(new URL("viewer-template.html", lib), "utf8");
const iconSvgs = JSON.parse(readFileSync(new URL("icons.json", lib), "utf8"));
const title = opts["--title"]?.trim() || diagram.title;
// exportHtml's two steps, so the payload can be checked between them.
const payload = buildPayload(template, {
  diagram,
  iconSvgs,
  theme,
  banner: opts["--banner"],
  title,
  startSimulation: start,
  ...(exportedOn ? { exportedOn } : {}),
});

/** Why the viewer would refuse this payload, or show it with something missing; undefined if it's fine. */
function viewerProblem() {
  const shown = parsePayload(scriptSafeJson(payload));
  if (!shown.ok) return shown.error;
  const dropped = Object.keys(payload.icons).filter((name) => !Object.hasOwn(shown.icons, name));
  if (dropped.length) return `It would leave out the icon${dropped.length === 1 ? "" : "s"} ${dropped.join(", ")}.`;
  if ((payload.options.banner ?? "") !== (shown.options.banner ?? ""))
    return `The banner is too long: the viewer shows at most ${shown.options.banner?.length ?? 0} characters.`;
  if (payload.options.startSimulation !== shown.options.startSimulation)
    return "It wouldn't play the chosen simulation.";
  return undefined;
}
const problem = viewerProblem();
if (problem) {
  console.error(`Can't export ${file}: the viewer wouldn't show the file as made. ${problem}`);
  process.exit(1);
}
const html = injectPayload(template, payload);

// --out: a file ending in .html, or a folder for <title>.html. By default, <title>.html beside the diagram.
const out = opts["--out"];
const target = out && /\.html?$/i.test(out) ? out : path.join(out ?? path.dirname(file), htmlFileName(title));
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, html);

const kB = Math.max(1, Math.round(Buffer.byteLength(html) / 1000)).toLocaleString("en-US");
const playing = start ? `, plays "${sims.find((s) => s.id === start)?.title ?? start}" when opened` : "";
console.log(`${target} (${kB} kB${playing})`);
console.log(
  "Private: it works offline and makes no network requests, and only people who have the file can open it. Share it where your team already controls access.",
);
