import type { CSSProperties } from "react";
import type { Stencil } from "../../model/types";
import { StencilIcon } from "../../components/StencilIcon";

/** Props shared by every node renderer variant (see src/harness/nodeVariants.tsx). */
export interface NodeBodyProps {
  stencil: Stencil;
  /** Localized display metadata, supplied by the lazy UI. Never a stored node label. */
  stencilName?: string;
  label: string;
  sublabel?: string;
  selected?: boolean;
  /** True when the stencil id wasn't found and the fallback is shown. */
  unknown?: boolean;
}

function accentStyle(stencil: Stencil): CSSProperties {
  return { "--accent": stencil.accent } as CSSProperties;
}

function cls(base: string, p: NodeBodyProps) {
  return [base, p.selected && "is-selected", p.unknown && "is-unknown"].filter(Boolean).join(" ");
}

/** Natural-size ink reserves geometry; only the painted title counter-scales. */
function NodeTitle({ label }: { label: string }) {
  return (
    <div className="nb-name">
      <span className="nb-name-size" aria-hidden="true">
        {label}
      </span>
      <div className="nb-label" data-testid="card-title" title={label}>
        {label}
      </div>
    </div>
  );
}

export function CardNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-card", p)} style={accentStyle(p.stencil)}>
      <div className="nb-tile" data-testid="card-icon">
        <StencilIcon stencil={p.stencil} size={26} />
      </div>
      <div className="nb-text">
        <NodeTitle label={p.label} />
        {p.sublabel ? (
          <div className="nb-sub" data-testid="card-second-line">
            {p.sublabel}
          </div>
        ) : (
          <div className="nb-kind" data-testid="card-second-line">
            {p.stencilName ?? p.stencil.label}
          </div>
        )}
      </div>
    </div>
  );
}

export function CompactNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-compact", p)} style={accentStyle(p.stencil)}>
      <div className="nb-tile" data-testid="card-icon">
        <StencilIcon stencil={p.stencil} size={18} />
      </div>
      <NodeTitle label={p.label} />
    </div>
  );
}

export function IconOnlyNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-icon", p)} style={accentStyle(p.stencil)}>
      <div className="nb-tile" data-testid="card-icon">
        <StencilIcon stencil={p.stencil} size={34} />
      </div>
      <div className="nb-caption" data-testid="node-caption">
        <NodeTitle label={p.label} />
        {p.sublabel && (
          <div className="nb-sub" data-testid="card-second-line">
            {p.sublabel}
          </div>
        )}
      </div>
    </div>
  );
}
