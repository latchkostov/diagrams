import { memo, useCallback } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { Icon } from "../../components/Icon";
import { useTooltip } from "../../components/useTooltip";
import { RELATION_META, type DependencyRelation } from "../../model/relations";
import { pipsByNode } from "./dependencyRows";
import { relationIcon } from "../../editor/relationActions";
import type { DiagramFlowEdge, DiagramNodeData } from "../types";

const MAX = 3;
const EMPTY: readonly { relation: DependencyRelation; target: string }[] = [];

function DependencyPipsImpl({ id }: { id: string }) {
  const rows = useStore(
    useCallback((s: ReactFlowState) => pipsByNode(s.edges as DiagramFlowEdge[]).get(id) ?? EMPTY, [id]),
  );
  // JSON encodes labels losslessly and gives the store a stable primitive snapshot.
  const encodedLabels = useStore(
    useCallback(
      (s: ReactFlowState) =>
        JSON.stringify(
          rows.map((r) => {
            const d = s.nodeLookup.get(r.target)?.data as Partial<DiagramNodeData> | undefined;
            return d?.label || r.target;
          }),
        ),
      [rows],
    ),
  );
  const tooltip = useTooltip();
  if (!rows.length) return null;
  const labels = JSON.parse(encodedLabels) as string[];
  const kinds = [...new Set(rows.map((r) => r.relation))];
  const shown = kinds.slice(0, MAX);
  return (
    <>
      <button
        type="button"
        className="dn-pips nodrag nopan"
        {...tooltip.trigger}
        aria-label="Show dependencies"
        aria-describedby={tooltip.open ? `node-dependencies-${id}` : undefined}
        data-testid={`node-pips-${id}`}
        data-count={rows.length}
      >
        {shown.map((r) => (
          <span key={r} className={`dn-pip fe-rel-${r}`} data-testid={`node-pip-${id}-${r}`} aria-hidden>
            <Icon name={relationIcon(r)} size={11} />
          </span>
        ))}
        {kinds.length > MAX && (
          <span className="dn-pip-more" aria-hidden>
            +{kinds.length - MAX}
          </span>
        )}
      </button>
      {tooltip.open && (
        <div
          className="fe-card dn-pip-card nodrag nopan"
          {...tooltip.pointer}
          role="tooltip"
          id={`node-dependencies-${id}`}
          data-testid={`node-dependencies-${id}`}
        >
          <div className="fe-card-head">Dependencies</div>
          <ul>
            {rows.map((r, i) => (
              <li key={i}>
                {RELATION_META[r.relation].label} · {labels[i]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export const DependencyPips = memo(DependencyPipsImpl);
