import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "./controller";
import { EdgeDetails, NodeDetails } from "./NodeDetails";
import type { BadgeProps } from "./NodeBadges";
import { compileTopology } from "../sim/topology";
import type { HoverCardProps } from "./HoverCard";

const controller = vi.hoisted(() => ({ getState: vi.fn(), effectiveProps: vi.fn() }));
vi.mock("./context", () => ({ useLive: () => ({ presenting: false, controller }) }));
vi.mock("./lazyNodeSections", () => ({
  NodeSections: ({ concurrency, currentModel, groups }: BadgeProps) => (
    <>{JSON.stringify({ concurrency, currentModel, groups: groups && [...groups] })}</>
  ),
}));
vi.mock("./HoverCard", () => ({
  HoverCard: ({ summary, children, kind }: HoverCardProps) => (
    <>{kind === "node" ? children("threads") : JSON.stringify(summary.vitals)}</>
  ),
}));
const diagram: DiagramFile = {
  format: "diagrams/v1",
  title: "Calls",
  // Callers wait from p3-w1: this sync connection is a Request with caller readouts.
  planning: { revision: "p3-w1" },
  nodes: [
    { id: "a", stencil: "generic.service", label: "Caller", x: 0, y: 0 },
    { id: "b", stencil: "generic.service", label: "Target", x: 400, y: 0 },
  ],
  edges: [{ id: "call", from: "a", to: "b", kind: "sync" }],
};
it.each([undefined, 0, 40])("distinguishes unavailable request windows from measured %s", (count) => {
  const state = {
    snapshot: { edges: { call: { calls: { windowRequests: count, windowSucceeded: count } } } },
  } as unknown as LiveState;
  const markup = renderToStaticMarkup(
    <EdgeDetails diagram={diagram} topology={compileTopology(diagram)} state={state} id="call" pinned={false} />,
  );
  const vitals = JSON.parse(markup.replaceAll("&quot;", '"')) as { key: string; value: string }[];
  expect(vitals.find((v) => v.key === "requests")?.value).toBe(count === undefined ? "—" : `${count / 10}/s`);
  expect(vitals.find((v) => v.key === "goodput")?.value).toBe(count === undefined ? "—" : `${count / 10}/s`);
});

it("resolves hover-only processor settings from the current controller in the lazy surface", () => {
  controller.getState.mockReturnValue({ snapshot: { edges: {} } });
  controller.effectiveProps.mockReturnValue({ concurrency: 7 });
  const props = {
    node: { id: "a", data: { label: "Caller", stencil: "generic.service" } },
    diagram,
    s: { id: "a", role: "processor", status: "up", lag: {}, throughput: 0 },
    pinned: false,
  } as unknown as BadgeProps;
  const html = renderToStaticMarkup(<NodeDetails {...props} />).replaceAll("&quot;", '"');
  expect(JSON.parse(html)).toEqual({ concurrency: 7, currentModel: true });
  expect(controller.effectiveProps).toHaveBeenCalledWith("a");
});
