import { useRef, useState } from "react";
import { Inspector } from "../canvas/Inspector";
import { fromFlow, nodeToFlow } from "../canvas/convert";
import type { DiagramFlowNode } from "../canvas/types";
import type { EditorApi } from "../editor/types";

/** The focus request arrives before React Flow's selection, with the diagram or old node still shown. */
export function InspectorFocusLab() {
  const [node, setNode] = useState<DiagramFlowNode>();
  const [focus, setFocus] = useState<{ name: string; seq: number; target: string }>();
  const consumed = useRef(0);
  const editor: Pick<EditorApi, "beginNaming" | "doneNaming" | "updateNode" | "getDiagram"> = {
    beginNaming: () => "lab-name",
    doneNaming: () => {},
    updateNode: (_id, patch) => setNode((n) => (n ? { ...n, data: { ...n.data, ...patch } } : n)),
    getDiagram: () => fromFlow({ title: "Fields" }, node ? [node] : [], []),
  };
  return (
    <div>
      {[
        { id: "cache", stencil: "redis.cache", label: "Session store" },
        { id: "db", stencil: "postgres", label: "Orders database" },
      ].map((n) => (
        <button
          key={n.id}
          data-testid={`inspector-focus-${n.id}`}
          onClick={() => {
            setFocus((f) => ({ name: "label", seq: (f?.seq ?? 0) + 1, target: n.id }));
            requestAnimationFrame(() => setNode(nodeToFlow({ ...n, x: 0, y: 0 })));
          }}
        >
          {n.label}
        </button>
      ))}
      <Inspector
        editor={editor as EditorApi}
        meta={{ title: "Fields" }}
        selectedNodes={node ? [node] : []}
        selectedGroups={[]}
        selectedEdges={[]}
        groups={[]}
        nodeLabel={(id) => id}
        counts={{ nodes: node ? 1 : 0, edges: 0, groups: 0 }}
        collapsed={false}
        onToggle={() => {}}
        focus={focus}
        takeFocus={(seq) => {
          if (consumed.current === seq) return false;
          consumed.current = seq;
          return true;
        }}
      />
    </div>
  );
}
