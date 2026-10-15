// The published contracts and the agent skill (docs/PARITY.md): the schemas the site serves (generated fresh, by
// fingerprint: the files themselves are committed and kept equal to the generator by publicSchemas.test.ts), the
// skill's generated data and references (committed, kept fresh by skill.test.ts), and what the skill's scripts do
// on fixed inputs: validate, layout, share-link and export-html, run as an agent runs them.
import { describe, it } from "vitest";
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

const SKILL = join(ROOT, "skills/livediagrams");
const exampleFile = (slug: string) => join(ROOT, "src/examples", `${slug}.json`);
const diagramFile = (slug: string) =>
  slug.startsWith("corpus-")
    ? join(ROOT, "tests/parity/corpus", `${slug.slice("corpus-".length)}.diagram.json`)
    : exampleFile(slug);

/** Runs one of the skill's scripts; paths in its output are made relative to the repository. */
function script(name: string, args: string[]) {
  const r = spawnSync(process.execPath, [join(SKILL, "scripts", name), ...args], { cwd: ROOT, encoding: "utf8" });
  const clean = (s: string) => s.split(ROOT).join("<repo>").replace(/\\/g, "/").replace(/\r\n/g, "\n");
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
    Object.fromEntries(files.map((f) => [f, fingerprint(readFileSync(join(SKILL, f), "utf8").replace(/\r\n/g, "\n"))])),
  );
});

it("validate.mjs", () => {
  const r = script(
    "validate.mjs",
    allDiagrams.map((d) => diagramFile(d.slug)),
  );
  expectGoldenText("skill/validate.txt", `exit ${r.status}\n${r.stdout}${r.stderr}`);
});

describe("layout.mjs, share-link.mjs and export-html.mjs", () => {
  for (const { slug } of examples)
    it(slug, () => {
      const dir = mkdtempSync(join(tmpdir(), "parity-skill-"));
      try {
        const laid = script("layout.mjs", [exampleFile(slug), "--force", "--out", join(dir, "laid.json")]);
        const layout = JSON.parse(readFileSync(join(dir, "laid.json"), "utf8")) as DiagramFile;
        const link = script("share-link.mjs", [exampleFile(slug)]);
        // The link's bytes depend on zlib's version; what it decodes to doesn't.
        const fragment = /#d=([A-Za-z0-9_-]+)/.exec(link.stdout)?.[1] ?? "";
        const decoded = inflateRawSync(Buffer.from(fragment, "base64url")).toString("utf8");
        const out = join(dir, "export.html");
        const html = script("export-html.mjs", [
          exampleFile(slug),
          "--exported-on",
          "2026-01-01",
          "--theme",
          "dark",
          "--out",
          out,
        ]);
        const file = readFileSync(out, "utf8");
        const payloadText = /<script type="application\/json" id="diagram">([\s\S]*?)<\/script>/.exec(file)?.[1] ?? "";
        const payload = JSON.parse(payloadText) as { icons: Record<string, string> };
        expectGolden(`skill/scripts/${slug}.json`, {
          layout: {
            status: laid.status,
            stdout: laid.stdout.replace(dir.replace(/\\/g, "/"), "<tmp>"),
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
            stdout: html.stdout
              .replace(dir.replace(/\\/g, "/"), "<tmp>") // The file's size includes the released viewer template (refreshed by `pnpm skill:release`).
              .replace(/\d[\d,.]* [kMG]?B\b/, "<size>"),
            stderr: html.stderr,
            payload: {
              ...payload,
              icons: Object.fromEntries(Object.entries(payload.icons).map(([k, v]) => [k, fingerprint(v)])),
            },
          },
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
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
