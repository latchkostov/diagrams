#!/usr/bin/env node
// Usage: node scripts/export-html.mjs <file.diagram.json> [--out <path>] [--theme light|dark] [--banner "text"]
//                                     [--title "text"] [--sim <id>] [--no-autoplay] [--password-file <path> | --password <value>] [--force]
// Exports the app's offline, read-only interactive HTML (pan, zoom and simulations).
// CSP forbids network requests; nothing is stored in the browser. Anyone with the file can open it.
// Viewer, injection and icons come from ./lib (pnpm skill:release); its rules validate the payload.
// --password uses the app's encryption and hides the diagram, title and file name until unlocked.
// Explicit input only: prefer a user-created password file; a literal value appears in the conversation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { readViewer, readIcons } from "./lib/viewer.mjs";
import { checkFile } from "./lib/check.mjs";
import {
  lockedFileName,
  lockPayload,
  MIN_PASSWORD_LENGTH,
  parsePayload,
  passwordStrength,
  PAYLOAD_LIMITS,
  unlockPayloadText,
} from "./lib/app.mjs";
import { buildPayload, htmlFileName, injectLocked, injectPayload, scriptSafeJson } from "./lib/inject.mjs";

const USAGE =
  'Usage: node scripts/export-html.mjs <file.diagram.json> [--out <path>] [--theme light|dark] [--banner "text"] [--title "text"] [--sim <id>] [--no-autoplay] [--password-file <path> | --password <value>] [--force]';
const VALUED = ["--out", "--theme", "--banner", "--title", "--sim", "--exported-on", "--password-file", "--password"];
const FLAGS = ["--no-autoplay", "--force"];
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
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`${a} needs a value.\n${USAGE}`);
    opts[a] = args[++i];
  } else if (FLAGS.includes(a)) opts[a] = true;
  else if (a.startsWith("--password=")) fail("Use --password <value> or --password-file <path>. Nothing was written.");
  else if (a.startsWith("--")) fail(`Unknown option ${a}.\n${USAGE}`);
  else files.push(a);
}
if (opts["--password"] !== undefined && opts["--password-file"] !== undefined)
  fail("Choose either --password-file or --password. Nothing was written.");
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

const template = readViewer();
const iconSvgs = readIcons();
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
// Read only the user-selected path. Strip a single final line ending for ordinary text files;
// preserve every other character, including spaces. Never print or persist the password.
let password = opts["--password"];
if (opts["--password-file"] !== undefined) {
  try {
    password = readFileSync(opts["--password-file"], "utf8").replace(/\r?\n$/, "");
  } catch {
    fail("Could not read --password-file. Supply a readable local text file. Nothing was written.", 1);
  }
}
let html;
if (password === undefined) html = injectPayload(template, payload);
else {
  if (password.length < MIN_PASSWORD_LENGTH)
    fail(`Use a password of at least ${MIN_PASSWORD_LENGTH} characters. Nothing was written.`, 1);
  const strength = passwordStrength(password);
  if (strength.level === "weak") console.error(`warning: ${strength.hint}`);
  const locked = await lockPayload(payload, password);
  // Never write a file its own password wouldn't open: decrypt it again, as the viewer will.
  const opened = await unlockPayloadText(locked.encrypted, password, PAYLOAD_LIMITS.totalChars * 3);
  if (opened !== JSON.stringify(payload)) fail(`Can't export ${file}: the encrypted file didn't open again.`, 1);
  html = injectLocked(template, locked);
}

// --out: a file ending in .html, or a folder for <title>.html. By default, <title>.html beside the diagram. A
// password-protected file's name says nothing of the diagram: "Diagram (password protected) <random>.html".
// Nothing is ever replaced unless --force says so: a named --out that exists is refused, and a default name that's
// taken gets the next free one, " (2)" and on, which the script says.
const out = opts["--out"];
const named = Boolean(out && /\.html?$/i.test(out));
const wanted = named
  ? out
  : path.join(out ?? path.dirname(file), password === undefined ? htmlFileName(title) : lockedFileName());
let target = wanted;
if (!opts["--force"] && existsSync(target)) {
  if (named)
    fail(`${target} already exists. Nothing was written: choose another --out, or add --force to replace it.`, 1);
  const ext = path.extname(wanted);
  for (let n = 2; existsSync(target); n++) target = `${wanted.slice(0, -ext.length)} (${n})${ext}`;
  console.error(`note: ${path.basename(wanted)} already exists there, so this one is ${path.basename(target)}.`);
}
mkdirSync(path.dirname(target), { recursive: true });
try {
  // "wx": fails rather than replace a file that appeared since the check.
  writeFileSync(target, html, { flag: opts["--force"] ? "w" : "wx" });
} catch (err) {
  if (err?.code === "EEXIST") fail(`${target} appeared while exporting. Nothing was written; run it again.`, 1);
  throw err;
}

const kB = Math.max(1, Math.round(Buffer.byteLength(html) / 1000)).toLocaleString("en-US");
const playing = start ? `, plays "${sims.find((s) => s.id === start)?.title ?? start}" when opened` : "";
console.log(`${target} (${kB} kB${password === undefined ? "" : ", password protected"}${playing})`);
console.log(
  password === undefined
    ? "Private: it works offline and makes no network requests, and only people who have the file can open it. Share it where your team already controls access."
    : "Password protected: only people with the password can open it; nothing of the diagram is readable without it. Send the password separately. It can't be recovered: if it's lost, export again. The file works offline and makes no network requests.",
);
