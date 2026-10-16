// Exports, without the browser (docs/BENCHMARKS.md § Metrics): the Interactive HTML file (the real viewer template
// from the benchmark build, with the icons the diagram uses), draw.io and Mermaid, share links (compressed, base64)
// and the library thumbnail written on every save. SVG and PNG need a DOM: tests/bench/ui/export.bench.ts.
//
// Gates: the HTML export, draw.io and Mermaid grow linearly.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportHtml } from "../../../src/export/inject";
import { diagramToDrawio } from "../../../src/interop/drawio/write";
import { diagramToMermaid } from "../../../src/interop/mermaid/write";
import { decodeShare, encodeShare } from "../../../src/interop/share";
import { diagramThumb } from "../../../src/lib/thumbnail";
import { getStencil } from "../../../src/stencils/registry";
import type { DiagramFile } from "../../../src/model/types";
import { FAMILY_IDS } from "../../../src/bench/workloads";
import { eventPipeline } from "../../../src/bench/workloads/pipeline";
import { outDir, stats } from "../results";
import { cases, GATE_LARGE, GATE_SMALL, measure, samplesFor, suite, workload, workloadInfo } from "./harness";

const s = suite("exports");

/** The Interactive HTML viewer template a build emitted (pnpm bench builds first), else none. */
function template(): string | undefined {
  for (const dist of [join(outDir(), "dist"), "dist"]) {
    const dir = join(dist, "export");
    if (!existsSync(dir)) continue;
    const file = readdirSync(dir).find((f) => /^interactive-viewer-[0-9a-f]+\.html$/.test(f));
    if (file) return readFileSync(join(dir, file), "utf8");
  }
  return undefined;
}

/** The SVG text of every icon the diagram's stencils use (the export fetches the same files). */
function iconSvgs(d: DiagramFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of d.nodes) {
    const icon = getStencil(n.stencil).icon;
    const file = join("src", "stencils", "icons", `${icon}.svg`);
    if (!(icon in out) && existsSync(file)) out[icon] = readFileSync(file, "utf8");
  }
  return out;
}

const html = template();
s.rec.info.htmlTemplate = html ? `${html.length} chars` : "missing: build first (pnpm bench builds it)";

for (const { family, n, title } of cases(FAMILY_IDS))
  s.timing(`exports ${title}`, async () => {
    const d = workload(family, n);
    const w = workloadInfo(family, n, d);
    const samples = samplesFor(n);
    if (html) {
      const icons = iconSvgs(d);
      const input = { diagram: d, iconSvgs: icons, theme: "light" as const, exportedOn: "2026-01-01" };
      s.time(
        "interactiveHtml",
        measure(() => exportHtml(html, input), { samples }),
        w,
      );
      s.count("interactiveHtml-bytes", exportHtml(html, input).length, { w, unit: "chars" });
    }
    s.time(
      "drawio",
      measure(() => diagramToDrawio(d), { samples }),
      w,
    );
    s.time(
      "mermaid",
      measure(() => diagramToMermaid(d), { samples }),
      w,
    );
    s.time(
      "thumbnail",
      measure(() => diagramThumb(d), { samples }),
      w,
    );
    // Share links compress with CompressionStream: asynchronous, so each sample awaits one encode (the first is a
    // warm-up).
    const encodeTimes: number[] = [];
    for (let i = 0; i < Math.min(samples, 9); i++) {
      const t = performance.now();
      await encodeShare(d);
      encodeTimes.push(performance.now() - t);
    }
    s.time("shareEncode", stats(encodeTimes.slice(1)), w);
    const link = await encodeShare(d);
    s.count("shareLink-chars", link.length, { w, unit: "chars" });
    const decodeTimes: number[] = [];
    for (let i = 0; i < Math.min(samples, 9); i++) {
      const t = performance.now();
      await decodeShare(link);
      decodeTimes.push(performance.now() - t);
    }
    s.time("shareDecode", stats(decodeTimes.slice(1)), w);
  });

s.gating("the HTML export, draw.io and Mermaid grow linearly", () => {
  const small = eventPipeline(GATE_SMALL);
  const large = eventPipeline(GATE_LARGE);
  if (html) {
    const si = { diagram: small, iconSvgs: iconSvgs(small), theme: "light" as const, exportedOn: "2026-01-01" };
    const li = { diagram: large, iconSvgs: iconSvgs(large), theme: "light" as const, exportedOn: "2026-01-01" };
    s.growth(
      "interactiveHtml",
      () => exportHtml(html, si),
      () => exportHtml(html, li),
    );
  }
  s.growth(
    "drawio",
    () => diagramToDrawio(small),
    () => diagramToDrawio(large),
  );
  s.growth(
    "mermaid",
    () => diagramToMermaid(small),
    () => diagramToMermaid(large),
  );
});
