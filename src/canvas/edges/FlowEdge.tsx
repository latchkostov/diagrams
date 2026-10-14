import { useKeyboardFocusOn, useTooltip } from "../../components/useTooltip";
import { memo, useCallback, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { EdgeLabelRenderer, useReactFlow, useStore, type EdgeProps, type ReactFlowState } from "@xyflow/react";
import { InlineInput } from "../../components/InlineInput";
import { Icon } from "../../components/Icon";
import { useDiagram } from "../DiagramContext";
import type { DiagramFlowEdge, DiagramNodeData } from "../types";
import { pointAlong } from "../geometry/path";
import type { LabelPlacement } from "../geometry/labels";
import { useEdgeRoute, useRoutingOptions } from "./useEdgeRoute";
import { relationInfo, type EdgeRelationInfo } from "./relationInfo";
import { RELATION_META, isDependency, relationOf, type DependencyRelation } from "../../model/relations";
import { relationIcon } from "../../editor/relationActions";
import { useReadableScale } from "../useReadableScale";
import { EdgeEnds } from "./EdgeEnds";

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
  const { editing, setEditing, openEdgeMenu, reconnect } = useDiagram();
  const { updateEdgeData } = useReactFlow();
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
  const relation = isDependency(data) ? (relationOf(data) as DependencyRelation) : null;
  const isEditing = editing?.kind === "edge" && editing.id === id;
  if (!route) return null;
  const { path, label } = route;
  const mid = label ?? pointAlong(route.points, 0.5).point;
  // A firewall rule that denies: a "no entry" glyph just after the source, so it's never colour alone.
  const deny = !relation && data?.props?.deny === true ? denyPoint(route.points) : undefined;
  const settings = dep?.settings ?? [];
  const tip = relation ? dependencyTip(relation, dep, sourceStencil) : undefined;
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
      setEditing({ kind: "edge", id });
    },
    onContextMenu: (e: MouseEvent) => openEdgeMenu(e, id),
    ...(settings.length
      ? {
          ...tooltip.trigger,
        }
      : {}),
  };
  const glyph = (size: number) =>
    relation ? (
      <span className="fe-glyph-icon" data-testid={`edge-glyph-${id}`} aria-hidden>
        <Icon name={relationIcon(relation)} size={size} />
      </span>
    ) : null;

  let body: ReactNode = null;
  if (isEditing || (label && label.mode !== "glyph")) {
    body = (
      <div
        className={`fe-label fe-label-${relation ? `dep fe-rel-${relation}` : kind} is-${isEditing ? "editing" : label!.mode}${selected ? " is-selected" : ""}${relation && !isEditing ? " has-glyph" : ""} nodrag nopan`}
        style={isEditing ? editingStyle(mid.x, mid.y) : labelStyle(mid.x, mid.y, label)}
        data-testid={`edge-label-${id}`}
        data-dependency={relation ? "true" : undefined}
        title={
          isEditing || settings.length
            ? undefined
            : [label && label.mode !== "full" && label.mode !== "wrap" ? label.text : undefined, tip]
                .filter(Boolean)
                .join("\n") || undefined
        }
        {...(settings.length && !isEditing
          ? {
              tabIndex: -1,
              role: "button",
              "aria-describedby": card ? `edge-settings-${id}` : undefined,
              "aria-label": `${label?.text ?? ""}: show settings`,
            }
          : {})}
        {...labelEvents}
      >
        {isEditing ? (
          <InlineInput
            value={data?.label ?? ""}
            placeholder="Edge label"
            testId="edge-label-input"
            returnFocus={() => document.querySelector(`.react-flow__edge[data-id="${CSS.escape(id)}"]`)}
            onDone={(next) => {
              setEditing(null);
              const text = next?.trim() || undefined;
              if (text !== (data?.label || undefined)) updateEdgeData(id, { label: text });
            }}
          />
        ) : label!.mode === "dot" ? (
          <>
            {relation ? (
              glyph(11)
            ) : (
              <span className="fe-dot-num" aria-hidden>
                {label!.dot}
              </span>
            )}
            <span className="fe-dot-tip">{label!.text}</span>
          </>
        ) : relation ? (
          <>
            {glyph(12)}
            <span className="fe-label-text">{label!.lines.join("\n")}</span>
          </>
        ) : (
          label!.lines.join("\n")
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
      data-relation={relation ?? undefined}
      data-deny={deny ? "true" : undefined}
    >
      <path d={path} className="fe-halo" />
      <path d={path} className="fe-path react-flow__edge-path" markerEnd={`url(#${marker})`} />
      <path d={path} className="react-flow__edge-interaction" fill="none" strokeOpacity={0} strokeWidth={22} />
      {title(deny ? "Firewall rule: deny. What's routed here is blocked" : tip)}
      {deny && (
        <g className="fe-deny" transform={`translate(${deny.x} ${deny.y})`} data-testid={`edge-deny-${id}`}>
          <circle r={7} />
          <path d="M-4.2 4.2 4.2-4.2" />
        </g>
      )}
      {selected && reconnect && !isEditing && route.points.length > 1 && (
        <EdgeEnds
          id={id}
          source={source}
          target={target}
          start={route.points[0]}
          end={route.points[route.points.length - 1]}
        />
      )}
      {body && (
        <EdgeLabelRenderer>
          {body}
          {card && settings.length > 0 && label && (
            <SettingsCard
              pointer={tooltip.pointer}
              id={id}
              relation={relation!}
              settings={settings}
              note={referenceNote(relation!, sourceStencil)}
              x={mid.x}
              y={mid.y - label.height / 2}
            />
          )}
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

/**
 * Where a deny rule's glyph sits: 34 px along the route from its source (clear of a selected edge's end handle), or
 * a third of the way along a short one.
 */
function denyPoint(points: readonly { x: number; y: number }[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total > 0 ? pointAlong(points, Math.min(34, total / 3) / total).point : undefined;
}

/** An SVG <title> gives the line itself the implicit label as its hover tooltip. */
const title = (tip: string | undefined) => (tip ? <title>{tip}</title> : null);

/** "Secret · reads secrets", plus what a derived label summarises and how references resolve. */
function dependencyTip(relation: DependencyRelation, dep: EdgeRelationInfo | undefined, sourceStencil?: string) {
  const meta = RELATION_META[relation];
  // "Depends on" says its verb already ("Depends on · depends on" read twice).
  const same = meta.label.toLowerCase() === meta.implicit.toLowerCase();
  const parts = [same ? meta.label : `${meta.label} · ${meta.implicit}`];
  if (meta.why) parts.push(meta.why);
  const n = dep?.settings.length ?? 0;
  if (relation === "config" && n && !dep?.derived) {
    const secret = dep!.settings.filter((s) => s.secret).length;
    parts.push(`${n} setting${n === 1 ? "" : "s"}${secret ? ` · ${secret} secret` : ""}`);
  }
  const note = n ? referenceNote(relation, sourceStencil) : undefined;
  if (note) parts.push(note);
  return parts.join("\n");
}

/** How a config store's secret references really resolve (the app reads them, not the store). */
function referenceNote(relation: DependencyRelation, sourceStencil?: string): string | undefined {
  if (relation !== "secret") return undefined;
  if (sourceStencil === "azure.app-config")
    return "Each app resolves these with its own identity; App Configuration never calls Key Vault.";
  if (sourceStencil === "aws.parameter-store")
    return "Parameter Store passes these through to Secrets Manager; the caller still needs access to the secret.";
  return "Entries in the config store reference these secrets.";
}

function SettingsCard({
  pointer,
  id,
  relation,
  settings,
  note,
  x,
  y,
}: {
  pointer: ReturnType<typeof useTooltip>["pointer"];
  id: string;
  relation: DependencyRelation;
  settings: readonly { key: string; secret?: boolean }[];
  note?: string;
  x: number;
  y: number;
}) {
  const heading = relation === "secret" ? "Secret references" : "Settings read";
  const scale = useReadableScale();
  return (
    <div
      {...pointer}
      className="fe-card nodrag nopan"
      style={
        {
          transformOrigin: "0 0",
          transform: `translate(${x}px, ${y - 8}px) scale(${scale}) translate(-50%, -100%)`,
          "--fe-card-scale": scale,
        } as CSSProperties
      }
      role="tooltip"
      id={`edge-settings-${id}`}
      data-testid={`edge-settings-${id}`}
    >
      <div className="fe-card-head">{heading}</div>
      <ul>
        {settings.slice(0, 24).map((s, i) => (
          <li key={s.key} data-testid={`edge-setting-${id}-${i}`} data-secret={s.secret ? "1" : undefined}>
            <span className="fe-card-lock" aria-hidden>
              {s.secret && <Icon name="lock" size={11} />}
            </span>
            <span className="fe-card-key">{s.key}</span>
            {s.secret && <span className="sr-only"> (secret)</span>}
          </li>
        ))}
        {settings.length > 24 && <li className="fe-card-more">+{settings.length - 24} more</li>}
      </ul>
      {relation === "config" && settings.some((s) => s.secret) && (
        <div className="fe-card-note">
          <Icon name="lock" size={10} /> = a secret reference, resolved from a secret store
        </div>
      )}
      {note && <div className="fe-card-note">{note}</div>}
    </div>
  );
}

/** Placement is computed in flow px with the pill's exact metrics, so the box is set explicitly. */
/**
 * The label's editor never reads smaller than its CSS size: below 100% zoom it scales up by 1/zoom
 * (`--edit-scale`, set in CSS from the canvas's zoom), centred on the label's spot.
 */
function editingStyle(x: number, y: number): CSSProperties {
  return {
    transform: `translate(${x}px, ${y}px) scale(var(--edit-scale, 1)) translate(-50%, -50%)`,
    transformOrigin: "0 0",
  };
}

function labelStyle(x: number, y: number, label: LabelPlacement | null): CSSProperties {
  const base: CSSProperties = { transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` };
  if (!label) return base;
  return { ...base, "--fe-w": `${label.width}px`, "--fe-h": `${label.height}px` } as CSSProperties;
}

export const FlowEdge = memo(FlowEdgeImpl);

const DEP_RELATIONS: DependencyRelation[] = ["config", "secret", "identity", "telemetry", "deploy", "depends"];

/** Arrowhead markers referenced by FlowEdge. Render once per canvas. */
export function EdgeMarkers() {
  const arrow = "M1.5 1.5 L10.5 6 L1.5 10.5 L4 6 Z";
  // Dependencies: an open chevron, stroked in the relation's tint (markers can't inherit a stroke).
  const open = "M3 2.25 L9.75 6 L3 9.75";
  return (
    <svg className="df-defs" aria-hidden width="0" height="0">
      <defs>
        {[
          ["df-arrow", "m-async"],
          ["df-arrow-sync", "m-sync"],
          ["df-arrow-selected", "m-selected"],
        ].map(([markerId, cls]) => (
          <marker
            key={markerId}
            id={markerId}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="12"
            markerHeight="12"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d={arrow} className={cls} />
          </marker>
        ))}
        {[...DEP_RELATIONS, "selected"].map((r) => (
          <marker
            key={r}
            id={`df-arrow-dep-${r}`}
            viewBox="0 0 12 12"
            refX="10"
            refY="6"
            markerWidth="11"
            markerHeight="11"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path d={open} className={`m-dep m-dep-${r}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
