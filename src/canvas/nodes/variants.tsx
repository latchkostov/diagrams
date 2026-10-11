import type { CSSProperties } from "react";
import type { Stencil } from "../../model/types";
import { StencilIcon } from "../../components/StencilIcon";

/** Props shared by every node renderer variant (see src/harness/nodeVariants.tsx). */
export interface NodeBodyProps {
  stencil: Stencil;
  label: string;
  sublabel?: string;
  selected?: boolean;
  /** True when the stencil id wasn't found and the fallback is shown. */
  unknown?: boolean;
}

function accentStyle(stencil: Stencil): CSSProperties {
  return { "--accent": stencil.accent } as CSSProperties;
}

/** Tooltip with the full text: labels truncate with an ellipsis once a card reaches its max width. */
function fullText(p: NodeBodyProps) {
  return [p.label, p.sublabel, p.stencil.description].filter(Boolean).join("\n");
}

function cls(base: string, p: NodeBodyProps) {
  return [base, p.selected && "is-selected", p.unknown && "is-unknown"].filter(Boolean).join(" ");
}

export function CardNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-card", p)} style={accentStyle(p.stencil)} title={fullText(p)}>
      <div className="nb-tile">
        <StencilIcon stencil={p.stencil} size={26} />
      </div>
      <div className="nb-text">
        <div className="nb-label">{p.label}</div>
        {p.sublabel ? <div className="nb-sub">{p.sublabel}</div> : <div className="nb-kind">{p.stencil.label}</div>}
      </div>
    </div>
  );
}

export function CompactNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-compact", p)} style={accentStyle(p.stencil)} title={fullText(p)}>
      <div className="nb-tile">
        <StencilIcon stencil={p.stencil} size={18} />
      </div>
      <div className="nb-label">{p.label}</div>
    </div>
  );
}

export function IconOnlyNode(p: NodeBodyProps) {
  return (
    <div className={cls("nb nb-icon", p)} style={accentStyle(p.stencil)} title={fullText(p)}>
      <div className="nb-tile">
        <StencilIcon stencil={p.stencil} size={34} />
      </div>
      <div className="nb-caption">
        <div className="nb-label">{p.label}</div>
        {p.sublabel && <div className="nb-sub">{p.sublabel}</div>}
      </div>
    </div>
  );
}
