// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SectionRows } from "./HoverReadout";
import { nodeSummary, flowSummary, requestSummary } from "./hoverSummary";
import { DockedLive } from "./DockedLive";
import type { NodeSimState } from "../sim/types";

it("docked history samples simulation seconds without accumulating publication delay", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const summary = requestSummary(undefined, undefined, false, 0);
  const at = async (time: number) => {
    await act(() =>
      root.render(
        <DockedLive summary={summary} healthy="Healthy" time={time} value={time / 1000} kind="edge">
          {() => null}
        </DockedLive>,
      ),
    );
  };
  try {
    await at(0);
    // Each publication arrives a little later within its simulation second.
    for (let second = 1; second <= 12; second++) await at(second * 1000 + (second % 4) * 120);
    const samples = container.querySelector('[data-testid="hover-history-values"]')?.textContent;
    expect(samples?.match(/\d+(?:\.\d+)?\/s/g)).toHaveLength(10);
    await at(0);
    await at(1000);
    expect(
      container.querySelector('[data-testid="hover-history-values"]')?.textContent?.match(/\d+(?:\.\d+)?\/s/g),
    ).toHaveLength(1);
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});

const node: NodeSimState = {
  id: "worker",
  role: "processor",
  status: "down",
  backlog: 0,
  lag: {},
  inFlight: 0,
  processed: 0,
  failed: 0,
  dropped: 0,
  deadLettered: 0,
  throughput: 0,
};

it("ranks an expanded-only problem section before the compact sections", () => {
  const summary = nodeSummary(node, []);
  const html = renderToStaticMarkup(
    <SectionRows summary={summary} kind="node" pinned open={null} toggle={() => {}} render={() => null} />,
  );
  const keys = [...html.matchAll(/data-testid="hover-section-([^"]+)"/g)].map((m) => m[1]);
  expect(keys).toEqual(["outcomes", "latency", "threads", "resources", "planning"]);
  const compact = renderToStaticMarkup(
    <SectionRows summary={summary} kind="node" pinned={false} open={null} toggle={() => {}} render={() => null} />,
  );
  expect(compact).not.toContain('data-testid="hover-section-outcomes"');
  expect(compact).not.toContain('data-testid="hover-section-planning"');
});

it.each(["node", "edge"] as const)("opens only an available default section on a %s", (kind) => {
  const summary = kind === "node" ? nodeSummary(node, []) : flowSummary("flow", undefined);
  summary.problems = [{ key: kind === "node" ? "down" : "timeout", text: "Problem" }];
  const rendered: string[] = [];
  renderToStaticMarkup(
    <DockedLive summary={summary} healthy="Healthy" time={1000} value={0} kind={kind}>
      {(key) => {
        rendered.push(key);
        return <p>{key}</p>;
      }}
    </DockedLive>,
  );
  expect(rendered).toEqual(kind === "node" ? ["latency"] : []);
});

it("keeps a matching Request default section", () => {
  const summary = requestSummary(undefined, undefined, true, 0);
  summary.problems = [{ key: "retry", text: "Retries" }];
  const html = renderToStaticMarkup(
    <DockedLive summary={summary} healthy="Healthy" time={1000} value={0} kind="edge">
      {(key) => <p data-testid="open-detail">{key}</p>}
    </DockedLive>,
  );
  expect(html).toContain('data-testid="open-detail">retries</p>');
});

it("collapses a fallback on its first click after the selected section disappears", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const summary = nodeSummary(node, []);
  summary.problems = [{ key: "lag", text: "Readers lagging" }];
  summary.sections.push({ key: "readers", label: "Readers", summary: "" });
  const render = () =>
    root.render(
      <DockedLive summary={summary} healthy="Healthy" time={1000} value={0}>
        {(key) => <p>{key}</p>}
      </DockedLive>,
    );
  try {
    await act(render);
    expect(
      container.querySelector('[data-testid="inspector-live-section-readers"]')?.getAttribute("aria-expanded"),
    ).toBe("true");
    summary.sections = summary.sections.filter((s) => s.key !== "readers");
    await act(render);
    const fallback = container.querySelector<HTMLButtonElement>('[data-testid="inspector-live-section-latency"]')!;
    expect(fallback.getAttribute("aria-expanded")).toBe("true");
    await act(() => fallback.click());
    expect(fallback.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
