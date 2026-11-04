// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CacheDetails } from "./CacheDetails";
import { cacheFixture } from "../lab/cacheFixture";
import { createEngine } from "../sim/engine";

vi.mock("../planning/cache", () => ({ configuredPlanning: () => undefined }));

it("indexes fanout labels linearly and reuses destinations across Live publications", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const diagram = cacheFixture();
  const engine = createEngine({ seed: 7 });
  engine.load(diagram);
  const state = engine.snapshot().nodes.cache;
  const count = 128;
  for (let i = 0; i < count; i++) {
    diagram.nodes.push({ ...diagram.nodes[2], id: `destination-${i}`, label: `Service ${i}` });
    diagram.edges.push({ id: `fetch-${i}`, from: "cache", to: `destination-${i}`, kind: "sync" });
  }
  let reads = 0;
  let edgeReads = 0;
  for (const node of diagram.nodes) {
    const id = node.id;
    Object.defineProperty(node, "id", {
      get: () => {
        reads++;
        return id;
      },
      configurable: true,
    });
  }
  for (const edge of diagram.edges) {
    const from = edge.from;
    Object.defineProperty(edge, "from", {
      get: () => {
        edgeReads++;
        return from;
      },
      configurable: true,
    });
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    await act(() => root.render(<CacheDetails diagram={diagram} id="cache" s={state} />));
    expect(reads).toBeLessThanOrEqual(diagram.nodes.length * 2);
    expect(edgeReads).toBeLessThanOrEqual(diagram.edges.length * 3);
    reads = 0;
    edgeReads = 0;
    for (let i = 0; i < 8; i++) {
      await act(() => root.render(<CacheDetails diagram={diagram} id="cache" s={{ ...state, throughput: i }} />));
    }
    expect(reads).toBe(0);
    expect(edgeReads).toBe(0);
    const next = {
      ...diagram,
      nodes: diagram.nodes.map((n) => (n.id === "origin" ? { ...n, label: "Renamed origin" } : n)),
      edges: [diagram.edges[1]],
    };
    state.cacheDetails = { window: { requests: 10, hits: 5, misses: 5, fetches: 5, seconds: 10 } };
    await act(() => root.render(<CacheDetails diagram={next} id="cache" s={state} />));
    expect(host.querySelector('[data-testid="cache-offload-counts"]')!.textContent).toContain("Renamed origin");
  } finally {
    await act(() => root.unmount());
  }
});
