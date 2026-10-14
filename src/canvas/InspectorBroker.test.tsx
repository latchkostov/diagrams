import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { Inspector, type InspectorProps } from "./Inspector";
import type { EditorApi } from "../editor/types";

vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));

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
    expect(renderToStaticMarkup(<Inspector {...props} />)).toContain("Subscription");
  }
  expect(getDiagram).toHaveBeenCalledTimes(0);
});
