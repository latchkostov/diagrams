import { ViewportPortal, useStore, type ReactFlowState } from "@xyflow/react";
import type { Finding } from "../../checks/types";
import type { EdgeRoute } from "../geometry/router";
import { pointAlong } from "../geometry/path";
import { useAllRoutes, useRoutingOptions } from "../edges/useEdgeRoute";

// While the Checks card is open: a small amber triangle (warning) or blue dot (suggestion) at the top-right
// of each node a finding names, and at the middle of each connection. In flow space, so they pan and zoom
// with the diagram. Never in presentation, exports or recordings (the card is never open there). A marker's
// tooltip is the finding's title; the row being hovered in the card makes its markers stand out.

type State = ReactFlowState;

interface Mark {
  id: string;
  x: number;
  y: number;
  severity: Finding["severity"];
  title: string;
  hot: boolean;
}

function marks(
  s: State,
  routes: ReadonlyMap<string, EdgeRoute>,
  byElement: ReadonlyMap<string, Finding[]>,
  hot: string | null,
): Mark[] {
  const box = (id: string) => {
    const n = s.nodeLookup.get(id);
    if (!n || n.hidden) return null;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    return { x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h };
  };
  const out: Mark[] = [];
  for (const [id, findings] of byElement) {
    const severity = findings.some((f) => f.severity === "warning") ? "warning" : "suggestion";
    const title = findings.map((f) => f.title).join("\n");
    const isHot = !!hot && findings.some((f) => f.id === hot);
    const node = box(id);
    if (node) {
      if (!node.w) continue;
      out.push({ id, x: node.x + node.w - 4, y: node.y - 4, severity, title, hot: isHot });
      continue;
    }
    // A connection's marker sits on its drawn route (the shared router, as FlowEdge draws it): at its label's
    // corner when it has one, else halfway along. Not drawn (hidden dependencies), no marker.
    const route = routes.get(id);
    if (!route?.points.length) continue;
    const at = route.label
      ? { x: route.label.x + route.label.width / 2, y: route.label.y - route.label.height / 2 }
      : pointAlong(route.points, 0.5).point;
    out.push({ id, x: at.x, y: at.y, severity, title, hot: isHot });
  }
  return out;
}

export function ChecksMarkers({ byElement, hot }: { byElement: ReadonlyMap<string, Finding[]>; hot: string | null }) {
  // Re-rendered as nodes move; only mounted while the card is open.
  const routes = useAllRoutes(useRoutingOptions());
  const list = useStore((s: State) => marks(s, routes, byElement, hot), sameMarks);
  return (
    <ViewportPortal>
      <div className="check-markers" data-testid="check-markers" aria-hidden>
        {list.map((m) => (
          <span
            key={m.id}
            className={`check-marker is-${m.severity}${m.hot ? " is-hot" : ""}`}
            style={{ transform: `translate(${m.x}px, ${m.y}px) translate(-50%, -50%)` }}
            title={m.title}
            data-testid={`check-marker-${m.id}`}
            data-severity={m.severity}
          >
            {m.severity === "warning" ? (
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path d="M8 1.75 15 14H1Z" />
                <path d="M8 6.5v3.25M8 11.6v.01" className="check-marker-ink" />
              </svg>
            ) : null}
          </span>
        ))}
      </div>
    </ViewportPortal>
  );
}

function sameMarks(a: Mark[], b: Mark[]): boolean {
  return (
    a.length === b.length &&
    a.every((m, i) => {
      const o = b[i];
      return m.id === o.id && m.x === o.x && m.y === o.y && m.severity === o.severity && m.hot === o.hot;
    })
  );
}
