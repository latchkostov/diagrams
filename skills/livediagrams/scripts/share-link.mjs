#!/usr/bin/env node
// Usage: node scripts/share-link.mjs <file.diagram.json> [--base <url>]
// Prints a livediagrams.dev link that opens the diagram. The whole diagram travels in the link's
// fragment (#d=…), which browsers never send to a server: nothing is uploaded. The encoding matches
// the app's (src/interop/share.ts): minified JSON, raw DEFLATE (RFC 1951), base64url without padding.
import process from "node:process";
import { deflateRawSync } from "node:zlib";
import { checkFile, spec } from "./lib/check.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--base");
const base = at === -1 ? `${spec.site}/` : args[at + 1];
const file = args.find((a, i) => !a.startsWith("--") && (at === -1 || i !== at + 1));
if (!file || !base) {
  console.error("Usage: node scripts/share-link.mjs <file.diagram.json> [--base <url>]");
  process.exit(2);
}

const { errors, diagram } = checkFile(file);
if (errors.length) {
  console.error(`${file} has ${errors.length} error${errors.length === 1 ? "" : "s"}; fix them first:`);
  for (const e of errors) console.error(`  error: ${e}`);
  console.error("Run node scripts/validate.mjs <file> for the full report.");
  process.exit(1);
}

/** The share payload for a diagram object. */
function encodeShare(d) {
  return deflateRawSync(Buffer.from(JSON.stringify(d), "utf8")).toString("base64url");
}

const url = `${base.replace(/#.*$/, "")}#d=${encodeShare(diagram)}`;
console.log(url);
if (url.length > spec.shareWarnLength)
  console.error(
    `warning: the link is ${url.length.toLocaleString("en-US")} characters. Chat apps and email may cut off links over ${spec.shareWarnLength.toLocaleString("en-US")}, so offer the .diagram.json file instead (it opens at livediagrams.dev with File > Open…).`,
  );
