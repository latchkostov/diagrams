import "../../styles/checks.css";
import { ViewportPortal, useStore, type ReactFlowState } from "@xyflow/react";
import type { Finding } from "../../checks/types";
import type { EdgeRoute } from "../geometry/router";
import { pointAlong } from "../geometry/path";
import { useAllRoutes, useRoutingOptions } from "../edges/useEdgeRoute";
import { findingTag } from "./findingOrder";
import { presentFinding } from "../../checks/presentation";
import { useLocale } from "../../i18n";

// Only the selected finding gets numbered tags. Other findings share one count badge per element.
// Positions follow flow space; ink and hit targets hold their screen size. Checks alone mounts this layer.

type State = ReactFlowState;

interface Mark {
  id: string;
  x: number;
  y: number;
  severity: Finding["severity"];
  title: string;
  hot: boolean;
  selected?: { id: string; number: number; title: string };
  count: number;
}

function marks(
  s: State,
  routes: ReadonlyMap<string, EdgeRoute>,
  byElement: ReadonlyMap<string, Finding[]>,
  hot: string | null,
  selected: string | null,
  numbers: ReadonlyMap<string, number>,
): Mark[] {
  const box = (id: string) => {
    const n = s.nodeLookup.get(id);
    if (!n || n.hidden) return null;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
  };
  const out: Mark[] = [];
  for (const [id, raw] of byElement) {
    const findings = raw.map(presentFinding);
    const severity = findings.some((f) => f.severity === "warning") ? "warning" : "suggestion";
    const title = findings.map((f) => f.title).join("\n");
    const isHot = !!hot && findings.some((f) => f.id === hot);
    const detail = findingTag(findings, selected, numbers);
    const node = box(id);
    if (node) {
      if (!node.w) continue;
      out.push({ id, x: node.x + node.w - 10, y: node.y + 14, severity, title, hot: isHot, ...detail });
      continue;
    }
    // Below the drawn midpoint, clear of the connection pill. Hidden dependencies have no marker.
    const route = routes.get(id);
    if (!route?.points.length) continue;
    const at = { ...pointAlong(route.points, 0.5).point };
    at.y += (route.label?.height ?? 0) / 2 + 32 / s.transform[2];
    out.push({ id, x: at.x, y: at.y, severity, title, hot: isHot, ...detail });
  }
  return out;
}

export function ChecksMarkers({
  byElement,
  hot,
  selected,
  numbers,
  onSelect,
  onFilter,
}: {
  byElement: ReadonlyMap<string, Finding[]>;
  hot: string | null;
  selected: string | null;
  numbers: ReadonlyMap<string, number>;
  onSelect(id: string): void;
  onFilter(id: string): void;
}) {
  useLocale();
  const routes = useAllRoutes(useRoutingOptions());
  const list = useStore((s: State) => marks(s, routes, byElement, hot, selected, numbers), sameMarks);
  return (
    <ViewportPortal>
      <div className="check-markers" data-testid="check-markers">
        {list.map((m) => (
          <FindingMarker key={m.id} mark={m} onSelect={onSelect} onFilter={onFilter} />
        ))}
      </div>
    </ViewportPortal>
  );
}

/** Shared tag ink for the canvas and the Lab. */
export function FindingMarker({
  mark: m,
  onSelect,
  onFilter,
}: {
  mark: Mark;
  onSelect(id: string): void;
  onFilter(id: string): void;
}) {
  return (
    <div
      className={`check-marker-group${m.hot ? " is-hot" : ""}`}
      style={{
        transform: `translate(${m.x}px, ${m.y}px) scale(calc(1 / var(--rf-zoom, 1))) translate(-100%, -50%)`,
      }}
      data-testid={`check-marker-${m.id}`}
      data-severity={m.severity}
    >
      {m.count > 0 && (
        <button
          type="button"
          className="check-count"
          data-testid={`check-count-${m.id}`}
          title={m.title}
          aria-label={`${m.count}: ${m.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onFilter(m.id);
          }}
        >
          <span className="check-count-ink">
            <span aria-hidden>⚠</span> {m.selected ? "+" : ""}
            {m.count}
          </span>
        </button>
      )}
      {m.selected && (
        <button
          type="button"
          className="check-tag"
          data-testid="check-marker"
          data-finding={m.selected.id}
          title={m.selected.title}
          aria-label={`${m.selected.number}. ${m.selected.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(m.selected!.id);
          }}
        >
          <span>{m.selected.number}</span>
        </button>
      )}
    </div>
  );
}

function sameMarks(a: Mark[], b: Mark[]): boolean {
  return (
    a.length === b.length &&
    a.every((m, i) => {
      const o = b[i];
      return (
        m.id === o.id &&
        m.x === o.x &&
        m.y === o.y &&
        m.severity === o.severity &&
        m.hot === o.hot &&
        m.title === o.title &&
        m.count === o.count &&
        m.selected?.id === o.selected?.id &&
        m.selected?.number === o.selected?.number
      );
    })
  );
}
