import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscalingLessons";
import { LiveController } from "../live/controller";
import { LiveContext, type LiveUi } from "../live/context";
import { NodePlanning } from "./NodePlanning";
import type { EditorApi } from "../editor/types";

// Render a client subscription synchronously: the test deliberately leaves its publication behind the engine.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: <T,>(_subscribe: unknown, read: () => T) => read(),
}));
vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));
// Resources is now a collapsed row. Render that body here; browser tests cover opening the disclosure.
vi.mock("../live/DockedLive", () => ({
  DockedLive: ({ children }: { children(section: string): ReactNode }) => children("resources"),
}));
it("offers Live instead of asking to dismantle a large caching diagram", () => {
  const getDiagram = vi.fn();
  const html = renderToStaticMarkup(
    <NodePlanning
      id="cache"
      editor={{ getDiagram } as unknown as EditorApi}
      counts={{ nodes: 257, edges: 2 }}
      cacheConfigured
    />,
  );
  expect(html).toContain("Expected hits aren&#x27;t available for this large diagram. Run Live to measure this rule.");
  expect(html).not.toContain("Simplify the diagram");
  expect(getDiagram).not.toHaveBeenCalled();
});
it("resource totals and replica rows share one clock between live publications", () => {
  const d = autoscalingFixture();
  d.nodes[0].props!.ratePerSec = 1;
  Object.assign(d.nodes[1].props!, {
    autoscaling: { mode: "off" },
    resources: { ...resourceLesson(), cpuMsPerMessage: 500 },
  });
  const c = new LiveController(d);
  try {
    c.setTraffic(true);
    c.setPlaying(true);
    c.step(4000);
    c.advance(1000);
    expect(c.getState().snapshot.time).toBe(4000);
    expect(c.realSnapshot().time).toBe(5000);
    const rows = c.replicaPage("worker");
    expect(c.getState().snapshot.nodes.worker.resources!.cpuRequestPct).not.toBe(rows[0].cpuRequestPct);
    const html = renderToStaticMarkup(
      <LiveContext.Provider value={{ controller: c, slowmo: { active: false } } as LiveUi}>
        <NodePlanning diagram={d} id="worker" />
      </LiveContext.Provider>,
    );
    const aggregate = Number(html.match(/data-testid="autoscaling-cpu">CPU: ([\d.]+)/)?.[1]);
    const replica = Number(html.match(/data-testid="autoscaling-replica-cpu">([\d.]+)/)?.[1]);
    expect(aggregate).toBeGreaterThan(0);
    expect(aggregate).toBeCloseTo(replica, 1);
  } finally {
    c.dispose();
  }
});
