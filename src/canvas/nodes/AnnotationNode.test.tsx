// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactFlowInstance } from "@xyflow/react";
import { expect, it, vi } from "vitest";
import type { AnnotationFlowNode, DiagramFlowEdge, FlowNode } from "../types";
import { toFlow } from "../convert";
import { createEditor, type EditorDeps } from "../../editor/useEditor";
import { AnnotationNode } from "./AnnotationNode";

const flow = vi.hoisted(() => ({ updateNode: vi.fn<ReactFlowInstance<FlowNode, DiagramFlowEdge>["updateNode"]>() }));
vi.mock("@xyflow/react", async (load) => ({
  ...(await load<typeof import("@xyflow/react")>()),
  useReactFlow: () => flow,
  useStoreApi: () => ({}),
}));
vi.mock("../../components/markdown/lazy", () => ({ MarkdownView: ({ text }: { text: string }) => text }));

it("auto-growth preserves a larger committed annotation while NodeProps still has its previous height", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const initial = toFlow({
    format: "diagrams/v2",
    title: "Notes",
    nodes: [],
    edges: [],
    annotations: [{ id: "note", kind: "note", text: "Before", x: 0, y: 0, width: 240, height: 110 }],
  });
  let nodes = initial.nodes;
  const rf = { getNodes: () => nodes, getEdges: () => [] } as unknown as ReactFlowInstance<FlowNode, DiagramFlowEdge>;
  const { api } = createEditor(rf, {
    meta: initial.meta,
    history: { hint: vi.fn() },
    setNodes: (update: Parameters<EditorDeps["setNodes"]>[0]) => {
      nodes = typeof update === "function" ? update(nodes) : update;
    },
  } as unknown as EditorDeps);
  flow.updateNode.mockImplementation((id, update) => {
    nodes = nodes.map((node) =>
      node.id === id ? ({ ...node, ...(typeof update === "function" ? update(node) : update) } as FlowNode) : node,
    );
  });
  const host = document.createElement("div");
  document.body.append(host);
  const react = createRoot(host);
  const render = () => {
    const node = nodes[0] as AnnotationFlowNode;
    // React Flow can publish new data before measured dimensions reach NodeProps.
    react.render(
      <AnnotationNode
        id={node.id}
        type="annotation"
        data={node.data}
        height={110}
        width={240}
        selected={false}
        dragging={false}
        draggable
        deletable
        selectable
        isConnectable={false}
        zIndex={0}
        positionAbsoluteX={0}
        positionAbsoluteY={0}
      />,
    );
  };
  try {
    await act(render);
    const content = host.querySelector('[data-testid="annotation-text-note"]')!;
    Object.defineProperty(content, "offsetHeight", { value: 9000 });
    content.parentElement!.style.padding = "0px";
    api.updateAnnotation("note", { text: "Inline edit", height: 20000 });
    api.updateAnnotation("note", { text: "Inspector edit" });
    await act(render);
    expect(api.getAnnotation("note")).toMatchObject({ text: "Inspector edit", height: 20000 });

    // Genuine overflow still grows a smaller box, through the same persistence reader.
    api.updateAnnotation("note", { text: "More text", height: 200 });
    await act(render);
    expect(api.getAnnotation("note")).toMatchObject({ text: "More text", height: 9000 });
  } finally {
    await act(() => react.unmount());
    host.remove();
    flow.updateNode.mockReset();
    vi.unstubAllGlobals();
  }
});
