// Exports, byte for byte: the .diagram.json the app saves (and its round trip), draw.io XML (and what reading it
// back gives), Mermaid (with and without the metadata comment, and read back), the legacy (v1) file, and the
// Interactive HTML file's payload and page around it.
import { afterEach, describe, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiagramFile } from "../../../src/model/types";
import { parseNative, preserveUnknown, serializeNative, validateDiagram } from "../../../src/interop/native";
import { withPrivacyField } from "../../../src/lib/diagramIO";
import { diagramToDrawio } from "../../../src/interop/drawio/write";
import { drawioPageToDiagram, readDrawio } from "../../../src/interop/drawio/read";
import { inlineIcons } from "../../../src/interop/icons";
import { getStencil } from "../../../src/stencils/registry";
import { iconUrl } from "../../../src/stencils/iconUrls";
import { diagramToMermaid } from "../../../src/interop/mermaid/write";
import { parseMermaid } from "../../../src/interop/mermaid/read";
import { buildPayload, injectPayload, scriptSafeJson } from "../../../src/export/inject";
import { assembleTemplate } from "../../../scripts/interactive-viewer";
import { allDiagrams, examples } from "../lib/corpus";
import { expectGolden, expectGoldenText, ROOT } from "../lib/golden";
import { fingerprint, sha256 } from "../lib/hash";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** What the app saves: the canvas's diagram, validated (src/interop/useInterop.tsx `current`), as text. */
function saved(d: DiagramFile): { text: string; warnings: string[] } {
  const v = validateDiagram(structuredClone(d));
  if (!v.ok) throw new Error(`invalid: ${v.error}`);
  const file = withPrivacyField(preserveUnknown(v.diagram, d), false);
  return { text: serializeNative(file), warnings: v.warnings };
}

describe("native .diagram.json", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, () => {
      const { text, warnings } = saved(diagram);
      const reread = parseNative(text);
      if (!reread.ok) throw new Error(`the saved file doesn't open: ${reread.error}`);
      expectGoldenText(`exports/native/${slug}.diagram.json`, text);
      expectGolden(`exports/native-meta/${slug}.json`, {
        warnings,
        reopenWarnings: reread.warnings,
        // Opening the saved file and saving it again gives the same bytes.
        roundTrip: serializeNative(withPrivacyField(preserveUnknown(reread.diagram, reread.diagram), false)) === text,
      });
    });
});

/** Icons as the browser would fetch them: the SVG files under src/stencils/icons, by their asset URL. */
function stubIconFetch(): void {
  const byUrl = new Map<string, string>();
  for (const file of readdirSync(join(ROOT, "src/stencils/icons")).filter((f) => f.endsWith(".svg"))) {
    const url = iconUrl(file.slice(0, -4));
    if (url) byUrl.set(url, join(ROOT, "src/stencils/icons", file));
  }
  vi.stubGlobal("fetch", async (url: string) => {
    const path = byUrl.get(String(url));
    return path
      ? new Response(readFileSync(path, "utf8"), { status: 200 })
      : new Response("not found", { status: 404 });
  });
}

describe("draw.io", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, async () => {
      const xml = diagramToDrawio(diagram);
      expectGoldenText(`exports/drawio/${slug}.drawio`, xml);
      // As the app exports it: the icons draw.io has no shape for, inlined.
      stubIconFetch();
      const lookup = await inlineIcons(diagram);
      const withIcons = diagramToDrawio(diagram, { iconSvg: lookup });
      const inlined = Object.fromEntries(
        [...new Set(diagram.nodes.map((n) => n.stencil))].sort().flatMap((id) => {
          const b64 = lookup(id);
          return b64 ? [[id, `${getStencil(id).icon} ${sha256(b64).slice(0, 16)}`]] : [];
        }),
      );
      const doc = await readDrawio(xml);
      const back = doc.pages.map((p) => drawioPageToDiagram(p, diagram.title));
      expectGolden(`exports/drawio-meta/${slug}.json`, {
        withIcons: { ...fingerprint(withIcons), inlined },
        readBack: back.map((b) => ({ warnings: b.warnings, diagram: b.diagram })),
      });
    });
});

describe("Mermaid", () => {
  for (const { slug, diagram } of allDiagrams)
    it(slug, () => {
      const text = diagramToMermaid(diagram);
      const plain = diagramToMermaid(diagram, { metadata: false });
      expectGoldenText(`exports/mermaid/${slug}.mmd`, text);
      expectGoldenText(`exports/mermaid-plain/${slug}.mmd`, plain);
      let readBack: unknown;
      try {
        const parsed = parseMermaid(plain, diagram.title);
        readBack = { warnings: parsed.warnings, diagram: parsed.diagram };
      } catch (err) {
        readBack = { error: (err as Error).message };
      }
      expectGolden(`exports/mermaid-read/${slug}.json`, readBack);
    });
});

describe("Interactive HTML", () => {
  // The page around the viewer, assembled by the same function the build uses, with placeholder code: the real
  // viewer script and style are build output (the browser tier opens a real export).
  const template = assembleTemplate("/* viewer script */", "/* viewer style */");
  const icons = Object.fromEntries(
    readdirSync(join(ROOT, "src/stencils/icons"))
      .filter((f) => f.endsWith(".svg"))
      .sort()
      .map((f) => [f.slice(0, -4), readFileSync(join(ROOT, "src/stencils/icons", f), "utf8")]),
  );
  for (const { slug, diagram } of examples)
    for (const theme of ["light", "dark"] as const)
      it(`${slug} (${theme})`, () => {
        const sims = diagram.simulations ?? [];
        const payload = buildPayload(template, {
          diagram,
          iconSvgs: icons,
          theme,
          banner: theme === "dark" ? "Confidential: internal use only" : undefined,
          // Light keeps every simulation and starts the first; dark keeps the last one only.
          simulations: theme === "dark" ? sims.slice(-1).map((s) => s.id) : undefined,
          startSimulation: sims[0]?.id ?? null,
          exportedOn: "2026-01-01",
        });
        const html = injectPayload(template, payload);
        const json = scriptSafeJson(payload);
        if (!html.includes(json)) throw new Error("the payload isn't in the file as scriptSafeJson writes it");
        expectGoldenText(`exports/html/${slug}.${theme}.html`, html.replace(json, "«payload: see the .json beside»"));
        expectGolden(`exports/html/${slug}.${theme}.json`, {
          file: fingerprint(html),
          payload: {
            ...payload,
            icons: Object.fromEntries(Object.entries(payload.icons).map(([k, v]) => [k, fingerprint(v)])),
          },
        });
      });
});
