#!/usr/bin/env node
// Usage: node scripts/validate.mjs <file.diagram.json> [more files…]
// Checks each diagram's structure, required fields, unique ids, edge endpoints, stencil ids and
// simulations, then runs the app's own file validator: a valid diagram opens in the app exactly as
// written. Prints every problem with how to fix it. Exits 1 if any file has errors.
import process from "node:process";
import { checkFile } from "./lib/check.mjs";

const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!files.length) {
  console.error("Usage: node scripts/validate.mjs <file.diagram.json> [more files…]");
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  const { errors, warnings, summary } = checkFile(file);
  if (errors.length) {
    failed++;
    console.log(`INVALID ${file}: ${errors.length} error${errors.length === 1 ? "" : "s"}`);
  } else console.log(`VALID ${file}: ${summary}`);
  for (const e of errors) console.log(`  error: ${e}`);
  for (const w of warnings) console.log(`  warning: ${w}`);
}
process.exit(failed ? 1 : 0);
