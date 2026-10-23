import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { LiveState } from "./controller";
import { EdgeDetails } from "./NodeDetails";
import { compileTopology } from "../sim/topology";
import type { HoverCardProps } from "./HoverCard";

vi.mock("./context", () => ({ useLive: () => ({ presenting: false }) }));
vi.mock("./HoverCard", () => ({
  HoverCard: ({ summary }: HoverCardProps) => <>{JSON.stringify(summary.vitals)}</>,
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
