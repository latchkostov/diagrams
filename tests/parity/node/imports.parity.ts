// Imports through the front door the app uses (importText / importFiles: sniffing, the reader, the layout and
// validation): compose, AsyncAPI, Kubernetes, Terraform (and its Draw everything replay), draw.io (pages and
// compressed), Mermaid, and hostile input. Each records the diagram, the warnings, the report (its texts as
// language-neutral codes, and in English), and the checks on what was imported.
import { describe, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { importFiles, importText, detectFormat, type ImportOutcome } from "../../../src/interop/formats";
import { replayOutcome } from "../../../src/interop/infra/pipeline";
import { formatImportMessage } from "../../../src/interop/ui/importMessages";
import type { ImportText } from "../../../src/interop/infra/graph";
import { runChecks } from "../../../src/checks/run";
import { fixture } from "../lib/corpus";
import { expectGolden, ROOT as ROOT_DIR } from "../lib/golden";

const IMPORTS = "tests/fixtures/imports";

function files(dir: string, names?: string[]) {
  const all = names ?? readdirSync(join(ROOT_DIR, dir)).sort();
  return all.map((name) => ({ name, text: fixture(`${dir}/${name}`) }));
}

/** Every ImportText in a report, in English, keyed by where it is. */
function english(value: unknown, path = "report", out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(value)) value.forEach((v, i) => english(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    if ("code" in value && "args" in value) out[path] = formatImportMessage(value as ImportText);
    else for (const [k, v] of Object.entries(value)) english(v, `${path}.${k}`, out);
  }
  return out;
}

/** An outcome as data. The report's whole-graph copies (for the picker and Draw everything) are summarised. */
function outcome(o: ImportOutcome): Record<string, unknown> {
  if (o.ok === false) return { ok: false, error: o.error };
  if (o.ok === "pages") return { ok: "pages", format: o.format, pages: o.pages };
  const { pick, ...report } = o.report ?? {};
  return {
    ok: true,
    format: o.format,
    warnings: o.warnings,
    report: o.report
      ? {
          ...report,
          ...(pick ? { pick: { format: pick.format, total: pick.total, groups: pick.groups } } : {}),
        }
      : null,
    reportEnglish: o.report ? english(report) : {},
    replay: o.replay ? replayRecord(o) : null,
    checks: runChecks(o.diagram).findings.map((f) => `${f.severity} ${f.id}`),
    diagram: o.diagram,
  };
}

/** Terraform's Draw everything: the same import drawn again from its data with every resource. */
function replayRecord(o: Extract<ImportOutcome, { ok: true }>): unknown {
  if (!o.replay) return null;
  const again = replayOutcome(o.replay, o.format, undefined, o.replay);
  if (again.ok !== true) return again.ok === false ? { ok: false, error: again.error } : { ok: again.ok };
  return {
    warnings: again.warnings,
    nodes: again.diagram.nodes.length,
    edges: again.diagram.edges.length,
    notDrawn: again.report?.notDrawn ?? [],
    diagram: again.diagram,
  };
}

const cases: [string, () => Promise<ImportOutcome>][] = [
  ["compose", () => importFiles(files(`${IMPORTS}/compose`))],
  ...readdirSync(join(ROOT_DIR, `${IMPORTS}/asyncapi`))
    .sort()
    .map((name): [string, () => Promise<ImportOutcome>] => [
      `asyncapi-${name.replace(/\.asyncapi\.yaml$/, "")}`,
      () => importFiles(files(`${IMPORTS}/asyncapi`, [name])),
    ]),
  ["asyncapi-joined", () => importFiles(files(`${IMPORTS}/asyncapi`))],
  ["kubernetes", () => importFiles(files(`${IMPORTS}/k8s`))],
  ["kubernetes-orders-api", () => importFiles(files(`${IMPORTS}/k8s`, ["orders-api.yaml"]))],
  ["terraform-aws-plan", () => importFiles(files(`${IMPORTS}/terraform`, ["aws-plan.json"]))],
  ["terraform-azure-state", () => importFiles(files(`${IMPORTS}/terraform`, ["azure-state.json"]))],
  ["hostile-yaml-bomb", () => importFiles(files(`${IMPORTS}/hostile`, ["yaml-bomb.yaml"]))],
  ["hostile-recursive-ref", () => importFiles(files(`${IMPORTS}/hostile`, ["recursive-ref.asyncapi.yaml"]))],
  ["mermaid-flowchart", () => importFiles(files("tests/parity/corpus/imports", ["flowchart.mmd"]))],
  ["mermaid-graph-td", () => importFiles(files("tests/parity/corpus/imports", ["graph-td.mmd"]))],
  ["mermaid-sequence", () => importFiles(files("tests/parity/corpus/imports", ["not-a-flowchart.mmd"]))],
  ["unknown-text", () => importText("hello, world", "notes.txt")],
];

describe("imports", () => {
  for (const [name, load] of cases) it(name, async () => expectGolden(`imports/${name}.json`, outcome(await load())));

  for (const file of ["azure-orders.drawio", "two-pages-compressed.drawio"])
    it(`drawio ${file}`, async () => {
      const text = fixture(`src/interop/drawio/fixtures/${file}`);
      const first = await importText(text, file);
      const pages =
        first.ok === "pages"
          ? Object.fromEntries(first.pages.map((p) => [p.name, outcome(first.pick(p.index))]))
          : undefined;
      expectGolden(`imports/drawio-${file.replace(/\.drawio$/, "")}.json`, {
        detected: detectFormat(text, file),
        outcome: outcome(first),
        ...(pages ? { pages } : {}),
      });
    });

  it("format detection", () => {
    const sniff = (dir: string) =>
      Object.fromEntries(
        readdirSync(join(ROOT_DIR, dir))
          .sort()
          .map((name) => [`${dir}/${name}`, detectFormat(fixture(`${dir}/${name}`), name) ?? null]),
      );
    expectGolden("imports/detect.json", {
      ...sniff(`${IMPORTS}/compose`),
      ...sniff(`${IMPORTS}/asyncapi`),
      ...sniff(`${IMPORTS}/k8s`),
      ...sniff(`${IMPORTS}/terraform`),
      ...sniff(`${IMPORTS}/hostile`),
      ...sniff("tests/parity/corpus/imports"),
      ...sniff("src/interop/drawio/fixtures"),
    });
  });
});
