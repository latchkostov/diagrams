// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import "../sim/cache/cacheRuntime";
import { catalogs } from "virtual:i18n/catalogs";
import { state, type Catalog } from "./core";
import { CacheFields } from "../planning/CacheFields";
import { CacheDetails } from "../live/CacheDetails";
import { FaultStep } from "../live/FaultStep";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "../sim/engine";
import type { EditorApi } from "../editor/types";
import { cdnCache } from "../tutorials/catalog/cdnCache";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
});

it("keeps the Arabic field → readout → purge learning path translated and isolates mixed-script labels", async () => {
  state.l = "ar";
  state.c = (await catalogs.ar()).default as Catalog;
  const diagram = cacheFixture();
  diagram.nodes[1].label = "Edge API العربية";
  diagram.nodes[2].label = "Origin API العربية";
  diagram.nodes[1].props!.cache = {
    rules: [
      { id: "pages", label: "GET /pages العربية", match: { types: ["Page"] }, policy: { ttlMs: 1000, keys: 20 } },
    ],
  };
  const version = { identity: {}, revision: 0 };
  const editor = { getDiagram: () => diagram, getDocumentVersion: () => version } as unknown as EditorApi;
  const host = document.createElement("div");
  const root = createRoot(host);
  let fields: string;
  try {
    flushSync(() =>
      root.render(
        <CacheFields editor={editor} nodeId="cache" props={diagram.nodes[1].props!} counts={{ nodes: 3, edges: 2 }} />,
      ),
    );
    fields = host.innerHTML;
  } finally {
    flushSync(() => root.unmount());
  }
  expect(fields).toContain("قد يتلقى القراء بيانات قديمة");
  expect(fields).toContain("مللي ثانية");
  expect(fields).toContain("تقديم النسخة القديمة لمدة");
  const engine = createEngine();
  engine.load(diagram);
  const node = engine.snapshot().nodes.cache;
  node.cache!.rules.pages = { requests: 1, hits: 0, misses: 1, notCached: 0, fetches: 1, fills: 0 };
  const readout = renderToStaticMarkup(<CacheDetails diagram={diagram} id="cache" s={node} />);
  expect(readout).toContain("أُجيب عن");
  expect(readout).toContain("\u2068GET /pages العربية\u2069");
  const purge = renderToStaticMarkup(
    <FaultStep
      diagram={diagram}
      fault={{ kind: "purge", node: "cache", mode: "soft", reason: "deploy", rule: "pages" }}
      testId="step"
      onChange={() => {}}
    />,
  );
  expect(purge).toContain("إبقاء النسخ المنتهية (مسح مرن)");
  expect(purge).toContain("نشر · إبقاء");
  expect(cdnCache.finish!.text()).toContain("إنشاء تدريب على الأعطال");
});
