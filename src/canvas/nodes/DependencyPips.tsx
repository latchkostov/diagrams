import { memo, useCallback, type CSSProperties } from "react";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { Icon } from "../../components/Icon";
import { useKeyboardFocusOn, useTooltip } from "../../components/useTooltip";
import { RELATION_META, type DependencyRelation } from "../../model/relations";
import { pipsByNode } from "./dependencyRows";
import { relationIcon } from "../../editor/relationActions";
import type { DiagramFlowEdge, DiagramNodeData } from "../types";
import { useReadableScale } from "../useReadableScale";

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
  // Not a Tab stop of its own (the canvas is one): the list opens when the node is reached from the keyboard.
  const nodeFocused = useKeyboardFocusOn(rows.length ? `.react-flow__node[data-id="${CSS.escape(id)}"]` : null);
  const tooltip = useTooltip(nodeFocused);
  if (!rows.length) return null;
  const labels = JSON.parse(encodedLabels) as string[];
  const kinds = [...new Set(rows.map((r) => r.relation))];
  const shown = kinds.slice(0, MAX);
  return (
    <>
      <button
        type="button"
        className="dn-pips nodrag nopan"
        tabIndex={-1}
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
      {tooltip.open && <DependencyCard id={id} rows={rows} labels={labels} pointer={tooltip.pointer} />}
    </>
  );
}

/** The list on hover or focus: one line per dependency, readable at any zoom. */
function DependencyCard({
  id,
  rows,
  labels,
  pointer,
}: {
  id: string;
  rows: readonly { relation: DependencyRelation; target: string }[];
  labels: readonly string[];
  pointer: ReturnType<typeof useTooltip>["pointer"];
}) {
  const scale = useReadableScale();
  return (
    <div
      className="fe-card dn-pip-card nodrag nopan"
      {...pointer}
      style={{ transform: `scale(${scale})`, "--fe-card-scale": scale } as CSSProperties}
      role="tooltip"
      id={`node-dependencies-${id}`}
      data-testid={`node-dependencies-${id}`}
    >
      <div className="fe-card-head">Dependencies</div>
      <ul>
        {rows.map((r, i) => (
          <li key={i} data-testid={`node-dependency-${id}-${i}`}>
            <span className={`dn-pip-card-glyph fe-rel-${r.relation}`} aria-hidden>
              <Icon name={relationIcon(r.relation)} size={11} />
            </span>
            <span>
              {RELATION_META[r.relation].label} · {labels[i]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const DependencyPips = memo(DependencyPipsImpl);
