import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { autoscalingFixture } from "../lab/autoscalingFixture";
import { resourceLesson } from "../model/autoscaling";
import { LiveController } from "../live/controller";
import { LiveContext, type LiveUi } from "../live/context";
import { NodePlanning } from "./NodePlanning";

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
