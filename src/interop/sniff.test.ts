import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { looksLikeDrawio } from "./sniff";

describe("draw.io format sniffing", () => {
  it.each([
    "<mxfile><diagram /></mxfile>",
    "\uFEFF \n<mxGraphModel />",
    '<?xml version="1.0"?>\n<mxfile />',
    "<!-- first --><!-- second -->\n<mxGraphModel />",
    '<?xml version="1.0"?> <!-- first -->\n<!-- second --> <mxfile />',
    '<svg content="&lt;mxfile&gt;" />',
    '<?xml version="1.0"?>\n<svg content="&lt;mxGraphModel&gt;" />',
    '<!-- exported diagram --> <svg content="&lt;mxfile&gt;" />',
  ])("recognizes XML and SVG exports: %s", (text) => {
    expect(looksLikeDrawio(text)).toBe(true);
  });

  it.each([
    "<!-- unfinished <mxfile />",
    '<?xml version="1.0" <mxfile',
    "<!-- comment --> <other><mxfile /></other>",
    "<mxfileExtra />",
    '<svg content="ordinary image" />',
    "<!--" + "x".repeat(4000) + "--><mxfile />",
  ])("rejects incomplete or unrelated roots: %s", (text) => {
    expect(looksLikeDrawio(text)).toBe(false);
  });

  it("bounds repeated adjacent comments before a nonmatching root without blocking the test process", () => {
    // Native regex backtracking is invisible to JS operation probes. Run the actual source in an
    // interruptible VM: this is a safety watchdog, not a millisecond performance assertion. The old
    // nested regex exceeds this watchdog exponentially even though the input fits the sniff window.
    const source = stripTypeScriptTypes(readFileSync("src/interop/sniff.ts", "utf8")).replaceAll("export ", "");
    const script = new Script(`${source}\nlooksLikeDrawio(input)`);
    expect(script.runInNewContext({ input: "<!--x-->".repeat(64) + "<other />" }, { timeout: 1000 })).toBe(false);
  });
});
