import { relationIcon } from "../../editor/relationActions";
import { pointAlong } from "../geometry/path";
import type { EdgeRelationInfo } from "./relationInfo";
import type { CSSProperties } from "react";
import type { useTooltip } from "../../components/useTooltip";
import { RELATION_META, type DependencyRelation } from "../../model/relations";
import { Icon } from "../../components/Icon";
import { useReadableScale } from "../useReadableScale";

export function SettingsCard({
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

/** "Secret · reads secrets", plus what a derived label summarises and how references resolve. */
export function dependencyTip(relation: DependencyRelation, dep: EdgeRelationInfo | undefined, sourceStencil?: string) {
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
export function referenceNote(relation: DependencyRelation, sourceStencil?: string): string | undefined {
  if (relation !== "secret") return undefined;
  if (sourceStencil === "azure.app-config")
    return "Each app resolves these with its own identity; App Configuration never calls Key Vault.";
  if (sourceStencil === "aws.parameter-store")
    return "Parameter Store passes these through to Secrets Manager; the caller still needs access to the secret.";
  return "Entries in the config store reference these secrets.";
}

/**
 * Where a deny rule's glyph sits: 34 px along the route from its source (clear of a selected edge's end handle), or
 * a third of the way along a short one.
 */
export function denyPoint(points: readonly { x: number; y: number }[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total > 0 ? pointAlong(points, Math.min(34, total / 3) / total).point : undefined;
}

export const denyTip = "Firewall rule: deny. What's routed here is blocked";

export function DenyMarker({ id, x, y }: { id: string; x: number; y: number }) {
  return (
    <g className="fe-deny" transform={`translate(${x} ${y})`} data-testid={`edge-deny-${id}`}>
      <circle r={7} />
      <path d="M-4.2 4.2 4.2-4.2" />
    </g>
  );
}

export function RelationGlyph({ id, relation, size }: { id: string; relation: DependencyRelation; size: number }) {
  return (
    <span className="fe-glyph-icon" data-testid={`edge-glyph-${id}`} aria-hidden>
      <Icon name={relationIcon(relation)} size={size} />
    </span>
  );
}
