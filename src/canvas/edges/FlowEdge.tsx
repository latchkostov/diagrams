import { edgeDetailsSnapshot, subscribeEdgeDetails } from "./edgeDetailsRuntime";
import { isDenyRule } from "../../stencils/netDevices";
import { useKeyboardFocusOn, useTooltip } from "../../components/useTooltip";
import {
  memo,
  useSyncExternalStore,
  useCallback,
  useEffect,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { EdgeLabelRenderer, useStore, type EdgeProps, type ReactFlowState } from "@xyflow/react";
import { useDiagram } from "../DiagramContext";
import type { DiagramFlowEdge, DiagramNodeData } from "../types";
import { pointAlong } from "../geometry/path";
import type { LabelPlacement } from "../geometry/labels";
import { useEdgeRoute, useRoutingOptions } from "./useEdgeRoute";
import { relationInfo } from "./relationInfo";
import { isDependency, relationOf, type DependencyRelation } from "../../model/relations";
import { requireEdgeModules } from "./readiness";
import { routeGeometry } from "../geometry/shapedRuntime";
import { defineLazySurface } from "../../lib/lazySurface";
import { useChip } from "../lowZoom";
const EdgeControls = defineLazySurface({
  id: "edge.shaping",
  load: () => import("./EdgeRouteHandles").then((m) => m.EdgeRouteHandles),
  placeholder: { render: () => null },
  focus: {},
  export: "skip",
  retryToast: true,
});

/**
 * An edge. A flow is async (dashed) or sync (solid). A dependency (config, secret, identity,
 * telemetry, deploy, depends on) is a thin dotted line with an open arrowhead, a muted tint and a
 * glyph: the glyph leads its label pill, or stands alone as a chip when there's no text.
 *
 * Geometry comes from the canvas-wide router (src/canvas/geometry/router.ts via useEdgeRoute):
 * obstacle-avoiding orthogonal routes, spread ports, nudged parallel tracks and collision-free
 * label spots (glyph chips included). Exactly one `path.react-flow__edge-path` per edge: the live
 * view places particles along it with getPointAtLength, so it always matches what's drawn.
 */
function FlowEdgeImpl(props: EdgeProps<DiagramFlowEdge>) {
  const { id, data, selected, source, target } = props;
  const chip = useChip("edges", id);
  const { rename, openEdgeMenu, reconnect } = useDiagram();
  const relation = isDependency(data) ? (relationOf(data) as DependencyRelation) : null;
  const denied = !relation && isDenyRule(data?.props);
  const dependency = !!relation || denied;
  const custom = !!data?.waypoints?.length;
  useEffect(() => {
    if (!custom && !dependency) return;
    requireEdgeModules(custom, dependency);
  }, [custom, dependency]);
  const detailsSnapshot = useCallback(() => (dependency ? edgeDetailsSnapshot() : undefined), [dependency]);
  const Details = useSyncExternalStore(subscribeEdgeDetails, detailsSnapshot, detailsSnapshot);
  const route = useEdgeRoute(id, useRoutingOptions());
  const dep = useStore(useCallback((s: ReactFlowState) => relationInfo(s.edges as DiagramFlowEdge[]).get(id), [id]));
  const sourceStencil = useStore(
    useCallback(
      (s: ReactFlowState) => (s.nodeLookup.get(source)?.data as Partial<DiagramNodeData> | undefined)?.stencil,
      [source],
    ),
  );
  // The settings open when the edge is reached from the keyboard (its label isn't a Tab stop: D14).
  const edgeFocused = useKeyboardFocusOn(
    dep?.settings?.length ? `.react-flow__edge[data-id="${CSS.escape(id)}"]` : null,
  );
  const tooltip = useTooltip(edgeFocused);
  const card = tooltip.open;
  const kind = data?.kind ?? "async";
  if (!route) return custom && !routeGeometry ? <g data-route-pending="shaped" /> : null;
  const { path, label } = route;
  const mid = label ?? pointAlong(route.points, 0.5).point;
  // A firewall rule that denies: a "no entry" glyph just after the source, so it's never colour alone.
  const deny = denied ? Details?.denyPoint(route.points) : undefined;
  const settings = dep?.settings ?? [];
  const tip = relation ? Details?.dependencyTip(relation, dep, sourceStencil) : undefined;
  const marker = selected
    ? relation
      ? "df-arrow-dep-selected"
      : "df-arrow-selected"
    : relation
      ? `df-arrow-dep-${relation}`
      : kind === "sync"
        ? "df-arrow-sync"
        : "df-arrow";
  const labelEvents = {
    onDoubleClick: (e: MouseEvent) => {
      e.stopPropagation();
      rename?.({ kind: "edge", id });
    },
    onContextMenu: (e: MouseEvent) => openEdgeMenu(e, id),
    ...(settings.length
      ? {
          ...tooltip.trigger,
        }
      : {}),
  };
  const glyph = (size: number) =>
    relation && Details ? <Details.RelationGlyph id={id} relation={relation} size={size} /> : null;

  const controls = selected && reconnect && route.points.length > 1 && (
    <EdgeControls id={id} source={source} target={target} route={route} />
  );
  const denyMarker = deny && Details && <Details.DenyMarker id={id} x={deny.x} y={deny.y} />;
  if (chip) {
    // While its route follows a held node (or it is being shaped), the edge draws its live natural path.
    const { value } = chip;
    const shown = !selected && value.natural === path ? value.path : path;
    return (
      <>
        {chip.chips.Edge(id, shown, !!relation, !!selected, value.lane, denyMarker)}
        {controls}
      </>
    );
  }

  let body: ReactNode = null;
  if (label && label.mode !== "glyph") {
    body = (
      <div
        className={`fe-label fe-label-${relation ? `dep fe-rel-${relation}` : kind} is-${label.mode}${selected ? " is-selected" : ""}${relation ? " has-glyph" : ""} nodrag nopan`}
        style={labelStyle(mid.x, mid.y, label)}
        data-testid={`edge-label-${id}`}
        data-edge={id}
        data-dependency={relation ? "true" : undefined}
        title={
          settings.length
            ? undefined
            : [label.mode !== "full" && label.mode !== "wrap" ? label.text : undefined, tip]
                .filter(Boolean)
                .join("\n") || undefined
        }
        {...(settings.length
          ? {
              tabIndex: -1,
              role: "button",
              "aria-describedby": card ? `edge-settings-${id}` : undefined,
              "aria-label": `${label.text}: show settings`,
            }
          : {})}
        {...labelEvents}
      >
        {label.mode === "dot" ? (
          <>
            {relation ? (
              glyph(11)
            ) : (
              <span className="fe-dot-num" aria-hidden>
                {label.dot}
              </span>
            )}
            <span className="fe-dot-tip">{label.text}</span>
          </>
        ) : relation ? (
          <>
            {glyph(12)}
            <span className="fe-label-text">{label.lines.join("\n")}</span>
          </>
        ) : (
          label.lines.join("\n")
        )}
      </div>
    );
  } else if (label && relation) {
    // No text: the glyph alone, as a round chip on the line.
    body = (
      <div
        className={`fe-label fe-chip fe-rel-${relation} is-glyph${selected ? " is-selected" : ""} nodrag nopan`}
        style={labelStyle(mid.x, mid.y, label)}
        data-testid={`edge-label-${id}`}
        data-dependency={relation ? "true" : undefined}
        title={tip}
        {...labelEvents}
      >
        {glyph(14)}
      </div>
    );
  }

  return (
    <g
      className={
        relation
          ? `fe fe-dep fe-rel-${relation}${selected ? " is-selected" : ""}`
          : `fe fe-${kind}${selected ? " is-selected" : ""}${deny ? " is-deny" : ""}`
      }
      data-testid={`edge-${id}`}
      data-route={route.custom ? "custom" : undefined}
      data-route-pending={dependency && !Details ? "details" : undefined}
      data-source-side={data?.sourceSide}
      data-target-side={data?.targetSide}
      data-relation={relation ?? undefined}
      data-deny={deny ? "true" : undefined}
    >
      <path d={path} className="fe-halo" />
      <path
        data-testid={`connection-stroke-${id}`}
        d={path}
        className="fe-path react-flow__edge-path"
        markerEnd={`url(#${marker})`}
      />
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {title(deny ? Details?.denyTip : tip)}
      {denyMarker}
      {controls}
      {body && (
        <EdgeLabelRenderer>
          {body}
          {card && settings.length > 0 && label && Details && (
            <Details.SettingsCard
              pointer={tooltip.pointer}
              id={id}
              relation={relation!}
              settings={settings}
              note={Details.referenceNote(relation!, sourceStencil)}
              x={mid.x}
              y={mid.y - label.height / 2}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

/** An SVG <title> gives the line itself the implicit label as its hover tooltip. */
const title = (tip: string | undefined) => (tip ? <title>{tip}</title> : null);

/** Placement is computed in flow px with the pill's exact metrics, so the box is set explicitly. */
function labelStyle(x: number, y: number, label: LabelPlacement): CSSProperties {
  return {
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
    "--fe-w": `${label.width}px`,
    "--fe-h": `${label.height}px`,
  } as CSSProperties;
}

export const FlowEdge = memo(FlowEdgeImpl);

const DEP_RELATIONS: DependencyRelation[] = ["config", "secret", "identity", "telemetry", "deploy", "depends"];

/** Arrowhead markers referenced by FlowEdge. Render once per canvas. */
export function EdgeMarkers() {
  const arrow = "M1.5 1.5 L10.5 6 L1.5 10.5 L4 6 Z";
  // Dependencies: an open chevron, stroked in the relation's tint (markers can't inherit a stroke).
  const open = "M3 2.25 L9.75 6 L3 9.75";
  const markers: [string, string, string, number][] = [
    ["df-arrow", "m-async", arrow, 12],
    ["df-arrow-sync", "m-sync", arrow, 12],
    ["df-arrow-selected", "m-selected", arrow, 12],
    ...[...DEP_RELATIONS, "selected"].map((r): [string, string, string, number] => [
      `df-arrow-dep-${r}`,
      `m-dep m-dep-${r}`,
      open,
      11,
    ]),
  ];
  return (
    <svg className="df-defs" aria-hidden width="0" height="0">
      <defs>
        {markers.map(([markerId, cls, path, size]) => (
          <marker
            key={markerId}
            id={markerId}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth={size}
            markerHeight={size}
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d={path} className={cls} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
