import { useMemo } from "react";
import type { LiveState } from "./controller";
import { useLive } from "./context";
import { LiveIcon } from "./icons";
import { formatCount } from "./format";

const KIND_LABEL: Record<string, string> = {
  inject: "in",
  deliver: "→",
  process: "✓",
  fail: "✕",
  retry: "↺",
  deadletter: "DLQ",
  drop: "drop",
  block: "deny",
  status: "●",
};

/** The engine's recent events (newest first), optionally filtered to one node. */
export function EventLog({ state }: { state: LiveState }) {
  const ui = useLive();
  const nodeId = ui.events.nodeId;
  const d = ui.controller.currentDiagram;
  const labels = useMemo(() => new Map(d.nodes.map((n) => [n.id, n.label || n.id])), [d]);
  const rows = useMemo(() => {
    const list = nodeId ? state.snapshot.events.filter((e) => e.nodeId === nodeId) : state.snapshot.events;
    return list.slice(-120).reverse();
  }, [state.snapshot.events, nodeId]);

  return (
    <aside className="lv-events" data-testid="live-events" data-editor-overlay aria-label="Event log">
      <header>
        <strong>Events</strong>
        <label className="lv-select lv-events-filter">
          <span className="sr-only">Filter by node</span>
          <select
            value={nodeId ?? ""}
            onChange={(e) => ui.showEvents(e.target.value || null)}
            data-testid="live-events-filter"
            name="live-events-filter"
          >
            <option value="">All nodes</option>
            {d.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label || n.id}
              </option>
            ))}
          </select>
          <LiveIcon name="chevron" size={11} />
        </label>
        <button
          className="lv-btn"
          onClick={() => ui.showEvents(nodeId, false)}
          aria-label="Close event log"
          data-testid="live-events-close"
        >
          <LiveIcon name="close" size={13} />
        </button>
      </header>
      {state.scale > 1 && (
        <p className="lv-events-scale" data-testid="live-events-scale">
          Each event is one dot, about {formatCount(state.scale)} messages. Counters show every message.
        </p>
      )}
      <ol className="mono" data-testid="live-events-list">
        {rows.length === 0 && (
          <li className="lv-events-empty">
            {nodeId ? `Nothing has happened at ${labels.get(nodeId)} yet.` : "No events yet."}
          </li>
        )}
        {rows.map((e, i) => (
          <li key={`${e.time}-${e.messageId ?? ""}-${e.kind}-${i}`} className={`ev-${e.kind}`} data-node={e.nodeId}>
            <span className="lv-ev-time">{(e.time / 1000).toFixed(2)}</span>
            <span className="lv-ev-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
            <span className="lv-ev-text">{e.text}</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}
