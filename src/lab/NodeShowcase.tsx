import type { CSSProperties } from "react";
import type { Stencil } from "../model/types";
import { FALLBACK_STENCIL, getStencil, stencils } from "../stencils/registry";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";

/** Node body states the matrix can show. */
export const NODE_STATES = ["default", "selected", "long-label", "no-sublabel", "unknown", "missing-icon"] as const;
export type NodeState = (typeof NODE_STATES)[number];

const STATE_LABEL: Record<NodeState, string> = {
  default: "Default",
  selected: "Selected",
  "long-label": "Long label",
  "no-sublabel": "No sublabel",
  unknown: "Unknown stencil",
  "missing-icon": "Missing icon",
};

interface CellSpec {
  stencil: Stencil;
  label: string;
  sublabel?: string;
  selected?: boolean;
  unknown?: boolean;
}

function cellFor(base: Stencil, state: NodeState): CellSpec {
  switch (state) {
    case "default":
      return { stencil: base, label: base.label, sublabel: base.defaultSublabel ?? "orders.created" };
    case "selected":
      return { stencil: base, label: base.label, sublabel: base.defaultSublabel, selected: true };
    case "long-label":
      return {
        stencil: base,
        label: `${base.label} for Customer Notification Preferences`,
        sublabel: "sb://contoso-prod-eastus2.servicebus.windows.net/topics/customer-preferences-changed",
      };
    case "no-sublabel":
      return { stencil: base, label: base.label };
    case "unknown":
      return { stencil: FALLBACK_STENCIL, label: "acme.quantum-bus", sublabel: "unknown stencil id", unknown: true };
    case "missing-icon":
      return { stencil: { ...base, icon: "__missing_icon__" }, label: base.label, sublabel: "icon file missing" };
  }
}

/** One node body inside a gallery-style stage (reuses the gallery's .tile-stage look). */
export function NodeCell({
  variant,
  spec,
  caption,
  testId,
}: {
  variant: NodeVariantId;
  spec: CellSpec;
  caption?: string;
  testId?: string;
}) {
  const { Component } = nodeVariants[variant];
  return (
    <figure className="lab-cell" data-testid={testId} style={{ "--accent": spec.stencil.accent } as CSSProperties}>
      <div className={`tile-stage stage-${variant} lab-cell-stage`}>
        <Component
          stencil={spec.stencil}
          label={spec.label}
          sublabel={spec.sublabel}
          selected={spec.selected}
          unknown={spec.unknown}
        />
      </div>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

/** Variants × stencils × states. */
export function NodeMatrix({
  variants,
  stencilIds,
  states,
}: {
  variants: NodeVariantId[];
  stencilIds: string[];
  states: readonly NodeState[];
}) {
  return (
    <div className="lab-sections">
      {variants.map((v) => (
        <section key={v} className="lab-section" data-testid={`lab-node-variant-${v}`}>
          <h3 className="lab-section-title">
            {nodeVariants[v].label} <span>{v}</span>
          </h3>
          <div className="lab-matrix">
            {stencilIds.map((id) => {
              const base = getStencil(id);
              return (
                <div key={id} className="lab-matrix-row">
                  <div className="lab-matrix-row-head mono">{id}</div>
                  <div className="lab-grid">
                    {states.map((s) => (
                      <NodeCell
                        key={s}
                        variant={v}
                        spec={cellFor(base, s)}
                        caption={STATE_LABEL[s]}
                        testId={`lab-node-${v}-${s}-${id}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/** Every stencil in one variant, optionally filtered. */
export function AllStencils({ variant, category, query }: { variant: NodeVariantId; category: string; query: string }) {
  const q = query.trim().toLowerCase();
  const list = stencils.filter(
    (s) =>
      (category === "all" || s.category === category) &&
      (!q || `${s.id} ${s.label} ${s.vendor}`.toLowerCase().includes(q)),
  );
  return (
    <div className="lab-sections">
      <p className="lab-note" data-testid="lab-stencil-count">
        {list.length} stencils
      </p>
      <div className="lab-grid">
        {list.map((s) => (
          <NodeCell
            key={s.id}
            variant={variant}
            spec={cellFor(s, "default")}
            caption={s.id}
            testId={`lab-stencil-${s.id}`}
          />
        ))}
      </div>
    </div>
  );
}

/** A single configurable node: the quickest way to eyeball a label / stencil combination. */
export function NodePlayground(p: {
  variant: NodeVariantId | "all";
  stencil: string;
  label: string;
  sublabel: string;
  selected: boolean;
}) {
  const stencil = getStencil(p.stencil);
  const spec: CellSpec = {
    stencil,
    label: p.label,
    sublabel: p.sublabel || undefined,
    selected: p.selected,
    unknown: stencil === FALLBACK_STENCIL,
  };
  const variants = p.variant === "all" ? (Object.keys(nodeVariants) as NodeVariantId[]) : [p.variant];
  return (
    <div className="lab-grid lab-grid-lg">
      {variants.map((v) => (
        <NodeCell key={v} variant={v} spec={spec} caption={nodeVariants[v].label} testId={`lab-playground-${v}`} />
      ))}
    </div>
  );
}
