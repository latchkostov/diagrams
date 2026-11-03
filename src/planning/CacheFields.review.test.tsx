// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CacheFields } from "./CacheFields";
import { cacheFixture } from "../lab/cacheFixture";
import type { EditorApi } from "../editor/types";

it("copies the editor document once per version and checks graph counts before copying", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const d = cacheFixture();
  d.nodes[1].props!.cache = { rules: [{ id: "pages", match: { types: ["Page"] }, policy: { ttlMs: 1000 } }] };
  const getDiagram = vi.fn(() => structuredClone(d));
  const identity = {};
  let revision = 0;
  const editor = { getDiagram, getDocumentVersion: () => ({ identity, revision }) } as unknown as EditorApi;
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = (nodes = d.nodes.length) =>
    act(() =>
      root.render(
        <CacheFields
          editor={editor}
          nodeId="cache"
          props={d.nodes[1].props!}
          counts={{ nodes, edges: d.edges.length }}
          planning={d.planning}
        />,
      ),
    );
  try {
    for (let i = 0; i < 8; i++) await render();
    expect(getDiagram).toHaveBeenCalledTimes(1);
    revision++;
    await render();
    expect(getDiagram).toHaveBeenCalledTimes(2);
    revision++;
    await render(257);
    expect(getDiagram).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Throughput explanation is unavailable");
    await render();
    expect(getDiagram).toHaveBeenCalledTimes(3);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
