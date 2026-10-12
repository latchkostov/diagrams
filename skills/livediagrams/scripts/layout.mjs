#!/usr/bin/env node
// Usage: node scripts/layout.mjs <file.diagram.json> [--force] [--out <file>]
// Lays the diagram out with the app's own layout and writes it back (or to --out):
// - if any node has no x and y (or with --force), every node is placed, left to right ("direction": "LR")
//   or top to bottom ("TB"), and every boundary box is fitted around its members;
// - otherwise boundaries without a box are fitted, and nothing else moves;
// - notes and texts without a position go in a row under the diagram.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { stripBom } from "./lib/check.mjs";
import { layoutDiagram } from "./lib/app.mjs";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const out = outAt === -1 ? undefined : args[outAt + 1];
const file = args.find((a, i) => !a.startsWith("--") && (outAt === -1 || i !== outAt + 1));
if (!file || (outAt !== -1 && !out)) {
  console.error("Usage: node scripts/layout.mjs <file.diagram.json> [--force] [--out <file>]");
  process.exit(2);
}

let data;
try {
  data = JSON.parse(stripBom(readFileSync(file, "utf8")));
} catch (err) {
  console.error(`Can't read ${file} as JSON: ${err.message}`);
  process.exit(1);
}
const result = layoutDiagram(data, { force: args.includes("--force") });
if (!result.ok) {
  console.error(`Can't lay out ${file}: ${result.error}`);
  console.error(`Fix it and run again, or run node scripts/validate.mjs ${file} for a full report.`);
  process.exit(1);
}
const { diagram, laidOut, fitted, placedNotes } = result;
const changes = [
  laidOut ? `placed ${diagram.nodes.length} nodes` : "",
  fitted.length ? `fitted ${fitted.length} boundar${fitted.length === 1 ? "y" : "ies"}` : "",
  placedNotes.length ? `placed ${placedNotes.length} note${placedNotes.length === 1 ? "" : "s"}` : "",
].filter(Boolean);
const target = out ?? file;
if (!changes.length && !out) {
  console.log(`${file}: nothing to lay out (every node has x and y). Use --force to lay it out again.`);
  process.exit(0);
}
writeFileSync(target, JSON.stringify(diagram, null, 2) + "\n");
console.log(`${target}: ${changes.length ? changes.join(", ") : "unchanged"}.`);
