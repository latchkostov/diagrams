// The directory channel is derived from the full skill's knowledge, never maintained as a second copy.
import { readFileSync } from "node:fs";
import path from "node:path";
import { SKILL_DIR, fillRegions, stencilsDoc, publicExamples, spec, specJson } from "./skill-gen";

export const LITE_DIR = "skills/livediagrams";
export const LITE_DESCRIPTION =
  "Draw architecture and event-driven system diagrams with live message-flow simulations as editable .diagram.json files.";

export function generateLiteFiles(root: string): Record<string, string | Buffer> {
  const read = (name: string) => readFileSync(path.join(root, SKILL_DIR, name), "utf8").replace(/\r\n/g, "\n");
  const full = read("SKILL.md");
  const plan = full.slice(full.indexOf("2. **Plan"), full.indexOf("5. **Lay it out."));
  const rules = full
    .slice(full.indexOf("## Rules"), full.indexOf("- If Node isn't available"))
    .replace(
      "After large changes, run `layout.mjs --force` to\n  lay out everything again.",
      "Leave existing positions unchanged unless the user asks for a new layout.",
    );
  const skill = `---
name: livediagrams
description: ${LITE_DESCRIPTION} Use when the user wants to diagram, draw, sketch or visualize a system architecture, an event-driven or messaging flow, a data pipeline, microservices or any distributed system, including a live message-flow simulation of traffic, outages, retries and dead-letter queues. Needs no browser, account, API key or upload.
license: MIT
---

# Live Diagrams

Turn a system description into an editable \`.diagram.json\` file for [livediagrams.dev](https://www.livediagrams.dev).
Nothing is uploaded and nobody needs an account or a key.

## Workflow

1. **Understand the request and choose the model.** For work, employer, team, client or customer systems,
   or internal names, hosts, accounts or clusters, set \`"private": true\`. Never make a share link for a
   Private diagram, including by hand. Never put secrets, credentials or personal data in a diagram.
   Read [reference/outputs.md](reference/outputs.md) for who can open each output.
${plan}
5. **Check by hand.** Compare every field with [reference/format.md](reference/format.md) and
   [spec.json](spec.json): exact stencil ids, unique ids, connection endpoints, boundary membership,
   model revisions, simulation properties and limits. Fix errors before handing back the file.
   Positions are optional: the app uses its layout engine on open if any node lacks numeric x/y.
6. **Hand back the diagram file.** Say where it is and that anyone with the file can open and edit it.
   To make an offline HTML file (with or without a password), a share link or an image, tell the user to
   open it at livediagrams.dev with **File > Open…** (read in the browser, nothing uploaded), then use
   the app's **Export** menu. Never claim this plugin produced HTML or a link. Never fake an image.

For one-step offline HTML export, exact layout and validation, install the full plugin with
\`/plugin marketplace add latchkostov/diagrams\` then \`/plugin install livediagrams-full@livediagrams\`.

${rules}`;
  const manifest = JSON.parse(read(".claude-plugin/plugin.json")) as Record<string, unknown>;
  Object.assign(manifest, {
    name: "livediagrams",
    displayName: "Live Diagrams",
    version: "1.1.0",
    description: LITE_DESCRIPTION,
    documentationUrl: "https://github.com/latchkostov/diagrams/tree/master/skills/livediagrams#readme",
  });
  const format = fillRegions(read("reference/format.md"), "reference/format.md")
    .replace(
      "it (`scripts/share-link.mjs` refuses) and don't upload it anywhere; hand the user the file or an Interactive HTML\n  file (`scripts/export-html.mjs`, see [outputs.md](outputs.md)).",
      "it and don't upload it anywhere; hand the user the diagram file. For an Interactive HTML file,\n  use the app (see [outputs.md](outputs.md)).",
    )
    .replace("`validate.mjs` rejects unknown ids.", "Check every id against the stencil reference.")
    .replace("Leave them out and run `scripts/layout.mjs`.", "Leave them out for the app to lay out on open.")
    .replaceAll("`layout.mjs`", "The app's layout on open")
    .replace("Run The app's layout on open to position this diagram;", "Open this diagram in the app to position it;")
    .replace(
      "Only make public share links when requested, never for a Private diagram. Use\n`node scripts/share-link.mjs <file>`; see [outputs.md](outputs.md) for output choices.",
      "For requested public share links, open the file in the app and use its Export menu, never for a Private diagram.\nSee [outputs.md](outputs.md) for output choices.",
    );
  const outputs =
    read("reference/outputs.md")
      .split("## Interactive HTML file")[0]
      .replace("Start with a validated, laid-out", "Start with a hand-checked")
      .replace(
        "Private diagrams never get share links, including hand-built ones; `share-link.mjs` refuses them.",
        "Private diagrams never get share links, including hand-built ones.",
      )
      .replace(
        "If nobody can answer, make HTML and explain the alternatives.",
        "If nobody can answer, return the diagram file and explain the alternatives.",
      ) +
    `## Making other outputs in the app

This plugin hands back the diagram file. For offline Interactive HTML (with or without a password),
an image or a requested share link, open it at [livediagrams.dev](https://www.livediagrams.dev) with
**File > Open…** or drag it onto the page. The browser reads it; nothing is uploaded.
Use the app's **Export** menu for HTML and images, or **File > Share…** for links.
Never claim the plugin produced HTML or a link. Never fake an image or pass off hand-drawn SVG as an export.

Anyone with an unencrypted file can open it. For company content, offer **Require a password** when
exporting HTML in the app: anyone with the file and password can open it. Ask the user to enter their
password in the app, never invent, save or reuse a plugin password. Send the password separately;
it cannot be recovered. Public links are for requested public content only; anyone with the link can open it.
`;
  return {
    ".claude-plugin/plugin.json": JSON.stringify(manifest, null, 2) + "\n",
    ".claude-plugin/icon.png": readFileSync(path.join(root, SKILL_DIR, ".claude-plugin/icon.png")),
    "SKILL.md": skill.replace(/\bnode /g, "component "),
    "README.md": `# Live Diagrams\n\n${LITE_DESCRIPTION}\n\nThis script-free directory plugin writes diagram files and checks them by hand against the shared format and stencil references. The app lays out missing positions when you open the file. No account, API key or upload is required.\n\n## Install and use\n\nInstall from the Claude directory, or use \`/plugin marketplace add latchkostov/diagrams\` then \`/plugin install livediagrams@livediagrams\`. Ask for an event pipeline with a worker outage and recovery as an editable diagram file.\n\n## Privacy and outputs\n\nOpen the file at livediagrams.dev with File > Open…; the browser reads it without uploading it. Use the app's Export menu for offline HTML or images and File > Share… for requested links. Anyone with a diagram file can read and edit it. Internal diagrams are marked Private; never include secrets, credentials or personal data. Files remain in your environment until you delete them. The agent platform handles conversations and files under its own policies. No connectors, hooks, telemetry or background services are supplied. This plugin is not intended for people under 18.\n\n## Two channels and releases\n\nOur marketplace recommends \`livediagrams-full\`, which adds one-step offline HTML export, exact layout and validation. The ZIP at https://www.livediagrams.dev/skill/ contains that full skill. Both channels share the same knowledge sources; \`pnpm regen\` or \`pnpm skill:release\` regenerates this entire folder. Never edit it by hand.\n\nReport issues at https://github.com/latchkostov/diagrams/issues, without credentials or sensitive diagrams. Licensed under MIT; see [LICENSE.md](LICENSE.md).\n`,
    "reference/format.md": format,
    "reference/outputs.md": outputs,
    "reference/simulation.md": fillRegions(read("reference/simulation.md"), "reference/simulation.md").replace(
      "`validate.mjs` suggests a value when one is\n  needed",
      "Choose a scale that keeps traffic within the limits",
    ),
    "reference/stencils.md": stencilsDoc(publicExamples(root)),
    "spec.json": specJson(spec()),
    "LICENSE.md": readFileSync(path.join(root, "LICENSE"), "utf8"),
  };
}
