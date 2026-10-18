// The published contracts and the agent skill (docs/PARITY.md): the schemas the site serves (generated fresh, by
// fingerprint: the files themselves are committed and kept equal to the generator by publicSchemas.test.ts), the
// skill's generated data and references (committed, kept fresh by skill.test.ts), and what the skill's scripts do
// on fixed inputs: validate, layout, share-link and export-html, run as an agent runs them.
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { DiagramFile } from "../../../src/model/types";
import { publicSchemaFiles } from "../../../src/ai/webmcp/publicSchemas";
import { allDiagrams, examples } from "../lib/corpus";
import { expectGolden, expectGoldenText, ROOT } from "../lib/golden";
import { fingerprint } from "../lib/hash";
import { stencilsDoc } from "../../../scripts/skill-gen";
import { normalizeScriptOutput } from "../lib/scriptOutput";

const SKILL = join(ROOT, "skills/livediagrams");
// Frozen inputs for the existing aggregate outputs, independent of later showcase additions. Retired examples left
// the cohort with their files (docs/EXAMPLES.md); their A1 input lives on in the corpus as a1-image-workers.
const ORIGINAL_EXAMPLES = [
  "aks-app-config-key-vault",
  "aws-serverless-orders",
  "azure-service-bus-integration",
  "branch-to-datacentre",
  "cdc-analytics",
  "cqrs-event-sourcing",
  "event-driven-data-platform",
  "gcp-streaming-analytics",
  "kafka-order-pipeline",
  "nightly-batch-elt",
  "notification-fanout",
  "outbox-saga-checkout",
  "rag-assistant",
  "webhook-ingestion",
];
const originals = examples.filter((e) => ORIGINAL_EXAMPLES.includes(e.slug));
it("retains every original aggregate input", () => {
  expect(originals.map((e) => e.slug)).toEqual(ORIGINAL_EXAMPLES);
});
const exampleFile = (slug: string) => join(ROOT, "src/examples", `${slug}.json`);
const diagramFile = (slug: string) =>
  slug.startsWith("corpus-")
    ? join(ROOT, "tests/parity/corpus", `${slug.slice("corpus-".length)}.diagram.json`)
    : exampleFile(slug);

/** Runs one of the skill's scripts; paths in its output are made relative to the repository. */
function script(name: string, args: string[], temporary?: string) {
  const r = spawnSync(process.execPath, [join(SKILL, "scripts", name), ...args], { cwd: ROOT, encoding: "utf8" });
  const clean = (s: string) => normalizeScriptOutput(s, ROOT, temporary);
  return { status: r.status, stdout: clean(r.stdout), stderr: clean(r.stderr) };
}

it("public schemas", () => {
  const files = publicSchemaFiles();
  expectGolden(
    "skill/public-schemas.json",
    Object.fromEntries(
      Object.entries(files).map(([name, text]) => {
        const json = JSON.parse(text) as { $defs?: object; properties?: object };
        return [
          name,
          {
            ...fingerprint(text),
            properties: Object.keys(json.properties ?? {}),
            defs: Object.keys(json.$defs ?? {}),
          },
        ];
      }),
    ),
  );
});

it("skill data and references", () => {
  const files = [
    "SKILL.md",
    "reference/format.md",
    "reference/outputs.md",
    "reference/simulation.md",
    "reference/stencils.md",
    "scripts/lib/spec.json",
  ];
  expectGolden(
    "skill/files.json",
    Object.fromEntries(
      files.map((f) => [
        f,
        fingerprint(
          // Preserve the original cohort's generated output; also pin the full current reference below.
          f === "reference/stencils.md"
            ? stencilsDoc(originals)
            : readFileSync(join(SKILL, f), "utf8").replace(/\r\n/g, "\n"),
        ),
      ]),
    ),
  );
  expectGolden(
    "skill/current-stencils.json",
    fingerprint(readFileSync(join(SKILL, "reference/stencils.md"), "utf8").replace(/\r\n/g, "\n")),
  );
});

it("validate.mjs", () => {
  const r = script(
    "validate.mjs",
    // Keep the original public cohort's transcript stable. New inputs get individual goldens below.
    allDiagrams
      .filter((d) => d.slug.startsWith("corpus-") || ORIGINAL_EXAMPLES.includes(d.slug))
      .map((d) => diagramFile(d.slug)),
  );
  expectGoldenText("skill/validate.txt", `exit ${r.status}\n${r.stdout}${r.stderr}`);
});

describe("validate.mjs added public examples", () => {
  for (const { slug } of examples.filter((d) => !ORIGINAL_EXAMPLES.includes(d.slug)))
    it(slug, () => {
      const r = script("validate.mjs", [exampleFile(slug)]);
      expectGoldenText(`skill/validate/${slug}.txt`, `exit ${r.status}\n${r.stdout}${r.stderr}`);
    });
});

describe("layout.mjs, share-link.mjs and export-html.mjs", () => {
  for (const { slug } of examples)
    it(slug, () => {
      const dir = mkdtempSync(join(tmpdir(), "parity-skill-"));
      try {
        const laid = script("layout.mjs", [exampleFile(slug), "--force", "--out", join(dir, "laid.json")], dir);
        const layout = JSON.parse(readFileSync(join(dir, "laid.json"), "utf8")) as DiagramFile;
        const link = script("share-link.mjs", [exampleFile(slug)]);
        // The link's bytes depend on zlib's version; what it decodes to doesn't.
        const fragment = /#d=([A-Za-z0-9_-]+)/.exec(link.stdout)?.[1] ?? "";
        const decoded = inflateRawSync(Buffer.from(fragment, "base64url")).toString("utf8");
        const out = join(dir, "export.html");
        const html = script(
          "export-html.mjs",
          [exampleFile(slug), "--exported-on", "2026-01-01", "--theme", "dark", "--out", out],
          dir,
        );
        const file = readFileSync(out, "utf8");
        const payloadText = /<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(file)?.[1] ?? "";
        const payload = JSON.parse(payloadText) as { icons: Record<string, string> };
        expectGolden(`skill/scripts/${slug}.json`, {
          layout: {
            status: laid.status,
            stdout: laid.stdout,
            nodes: Object.fromEntries(layout.nodes.map((n) => [n.id, [n.x, n.y]])),
            groups: Object.fromEntries((layout.groups ?? []).map((g) => [g.id, [g.x, g.y, g.width, g.height]])),
          },
          shareLink: {
            status: link.status,
            prefix: link.stdout.slice(0, link.stdout.indexOf("#d=") + 3),
            decoded: fingerprint(decoded),
            sameAsFile: decoded === JSON.stringify(JSON.parse(readFileSync(exampleFile(slug), "utf8"))),
            warned: link.stderr.includes("warning"),
          },
          exportHtml: {
            status: html.status,
            // The size includes the released viewer template, refreshed by pnpm skill:release.
            stdout: html.stdout.replace(/\d[\d,.]* [kMG]?B\b/, "<size>"),
            stderr: html.stderr,
            payload: {
              ...payload,
              icons: Object.fromEntries(Object.entries(payload.icons).map(([k, v]) => [k, fingerprint(v)])),
            },
          },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });
});

it("usage lines", () => {
  expectGolden("skill/usage.json", {
    validate: script("validate.mjs", []).stderr,
    layout: script("layout.mjs", []).stderr,
    shareLink: script("share-link.mjs", []).stderr,
    exportHtml: script("export-html.mjs", []).stderr,
  });
});
