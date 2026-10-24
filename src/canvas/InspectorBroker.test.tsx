import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { InspectorProps } from "./Inspector";
import { EdgePanel } from "./inspector/EdgePanel";
import type { EditorApi } from "../editor/types";

vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));

// Resolve the client-only panel loader so this server render still exercises the whole Inspector.
vi.mock("./inspector/lazyEdgePanel", () => import("./inspector/EdgePanel"));

it("edge typing reads broker vocabulary from metadata without serializing the graph", () => {
  const getDiagram = vi.fn(() => {
    throw new Error("whole graph read during edge typing");
  });
  const editor = {
    getDiagram,
    getNode: () => ({ stencil: "aws.sns" }),
  } as unknown as EditorApi;
  for (const group of ["b", "bi", "billing"]) {
    const props = {
      editor,
      meta: { format: "diagrams/v2", planning: { revision: "p2" }, title: "Test" },
      selectedNodes: [],
      selectedGroups: [],
      selectedEdges: [{ id: "read", source: "broker", target: "worker", data: { kind: "async", props: { group } } }],
      groups: [],
      nodeLabel: (id: string) => id,
      counts: { nodes: 2, edges: 1, groups: 0 },
      collapsed: false,
      onToggle: () => {},
    } as InspectorProps;
    expect(renderToStaticMarkup(<EdgePanel {...props} edge={props.selectedEdges[0]} />)).toContain("Subscription");
  }
  expect(getDiagram).toHaveBeenCalledTimes(0);
});

it("collapsed Request summaries render without reading the whole graph", () => {
  const getDiagram = vi.fn(() => {
    throw new Error("whole graph read for a collapsed summary");
  });
  const edge = {
    id: "call",
    source: "caller",
    target: "api",
    data: {
      kind: "sync" as const,
      props: {
        caller: { wait: "non-blocking", deadlineMs: 300, retry: { maxAttempts: 3 } },
      },
    },
  };
  const props = {
    editor: { getDiagram, getNode: () => ({ stencil: "generic.service" }) } as unknown as EditorApi,
    meta: { format: "diagrams/v2", planning: { revision: "p3-w2" }, title: "Test" },
    selectedNodes: [],
    selectedGroups: [],
    selectedEdges: [edge],
    groups: [],
    nodeLabel: (id: string) => id,
    counts: { nodes: 2, edges: 1, groups: 0 },
    collapsed: false,
    onToggle: () => {},
  } as InspectorProps;
  const html = renderToStaticMarkup(<EdgePanel {...props} edge={edge} />);
  expect(html).toContain("Frees the thread · 300 ms timeout · 3 attempts");
  expect(getDiagram).toHaveBeenCalledTimes(0);
});
