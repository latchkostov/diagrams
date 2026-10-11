import { memo, useCallback } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { Icon } from "../../components/Icon";
import { RELATION_META, isDependency, relationOf, type DependencyRelation } from "../../model/relations";
import { relationIcon } from "../../editor/relationActions";
import type { DiagramFlowEdge, DiagramNodeData } from "../types";

// While Show ▸ Dependencies is off, a node keeps its dependencies one hover away: up to three glyph
// pips (one per relationship it has) on its bottom edge, "+n" after that, and a tooltip listing each
// dependency ("Secret · Integration secrets").

const MAX = 3;
const cache = new WeakMap<readonly DiagramFlowEdge[], Map<string, string>>();

/** Node id -> "relation\ttarget\n..." for every dependency it needs (it's the edge's source). */
function pipsByNode(edges: readonly DiagramFlowEdge[]): Map<string, string> {
  let hit = cache.get(edges);
  if (hit) return hit;
  hit = new Map();
  for (const e of edges) {
    if (!isDependency(e.data)) continue;
    const line = `${relationOf(e.data)}\t${e.target}`;
    hit.set(e.source, hit.has(e.source) ? `${hit.get(e.source)}\n${line}` : line);
  }
  cache.set(edges, hit);
  return hit;
}

function DependencyPipsImpl({ id }: { id: string }) {
  const key = useStore(
    useCallback((s: ReactFlowState) => pipsByNode(s.edges as DiagramFlowEdge[]).get(id) ?? "", [id]),
  );
  const labels = useStore(
    useCallback(
      (s: ReactFlowState) =>
        key
          .split("\n")
          .map((line) => {
            const target = line.split("\t")[1];
            const d = s.nodeLookup.get(target)?.data as Partial<DiagramNodeData> | undefined;
            return d?.label || target;
          })
          .join("\n"),
      [key],
    ),
  );
  if (!key) return null;
  const rows = key.split("\n").map((line, i) => ({
    relation: line.split("\t")[0] as DependencyRelation,
    target: labels.split("\n")[i] ?? "",
  }));
  const kinds = [...new Set(rows.map((r) => r.relation))];
  const shown = kinds.slice(0, MAX);
  const tip = rows.map((r) => `${RELATION_META[r.relation].label} · ${r.target}`).join("\n");
  return (
    <div
      className="dn-pips"
      title={tip}
      aria-label={`Dependencies: ${rows.map((r) => `${RELATION_META[r.relation].label} ${r.target}`).join(", ")}`}
      role="note"
      data-testid={`node-pips-${id}`}
      data-count={rows.length}
    >
      {shown.map((r) => (
        <span key={r} className={`dn-pip fe-rel-${r}`} data-testid={`node-pip-${id}-${r}`}>
          <Icon name={relationIcon(r)} size={11} />
        </span>
      ))}
      {kinds.length > MAX && <span className="dn-pip-more">+{kinds.length - MAX}</span>}
    </div>
  );
}

export const DependencyPips = memo(DependencyPipsImpl);
