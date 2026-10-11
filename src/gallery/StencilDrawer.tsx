import { useEffect, useRef, type CSSProperties } from "react";
import type { Stencil } from "../model/types";
import { nodeVariants } from "../harness/nodeVariants";
import { categoryLabel } from "../lib/categories";
import { simRoleMeta } from "../lib/simRoles";
import { familyOf, getFamily } from "../lib/vendorFamilies";
import { Icon } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import { iconSource, roleExplained } from "./stencilInfo";

interface Props {
  stencil: Stencil;
  /** Position in the current results, for the "3 of 12" stepper. */
  index: number;
  total: number;
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
  onAdd: () => void;
  onNewDiagram: () => void;
  onCopy: (text: string, what: string) => void;
  onCopyJson: () => void;
}

/** Side sheet with everything about one stencil, and ways to put it on a diagram. */
export function StencilDrawer({
  stencil: s,
  index,
  total,
  onStep,
  onClose,
  onAdd,
  onNewDiagram,
  onCopy,
  onCopyJson,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const role = simRoleMeta[s.simRole] ?? simRoleMeta.none;
  const family = getFamily(familyOf(s));
  const icon = iconSource(s.icon);

  // Focus the sheet itself so Esc and the arrow keys work straight away, without a focus ring on a button.
  useEffect(() => root.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  return (
    <div
      ref={root}
      tabIndex={-1}
      className="drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="drawer-title"
      data-testid="stencil-drawer"
      data-stencil={s.id}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <header className="drawer-head">
        <span className="drawer-icon">
          <StencilIcon stencil={s} size={26} />
        </span>
        <div className="drawer-heading">
          <h2 id="drawer-title">{s.label}</h2>
          <span>{s.vendor}</span>
        </div>
        <div className="drawer-nav">
          <button
            className="icon-btn icon-btn-quiet"
            onClick={() => onStep(-1)}
            disabled={total < 2}
            aria-label="Previous stencil"
            title="Previous (←)"
            data-testid="drawer-prev"
          >
            <Icon name="chevron-right" size={14} />
          </button>
          <span className="drawer-pos" aria-live="polite">
            {index + 1} of {total}
          </span>
          <button
            className="icon-btn icon-btn-quiet"
            onClick={() => onStep(1)}
            disabled={total < 2}
            aria-label="Next stencil"
            title="Next (→)"
            data-testid="drawer-next"
          >
            <Icon name="chevron-right" size={14} />
          </button>
          <button
            className="icon-btn icon-btn-quiet"
            onClick={onClose}
            aria-label="Close details"
            title="Close (Esc)"
            data-testid="drawer-close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="drawer-body">
        <div className="drawer-stage" data-testid="drawer-preview">
          {Object.entries(nodeVariants).map(([id, v]) => (
            <figure key={id} className={`drawer-variant variant-${id}`}>
              <div className="drawer-variant-node">
                <v.Component stencil={s} label={s.label} sublabel={s.defaultSublabel} />
              </div>
              <figcaption>{v.label}</figcaption>
            </figure>
          ))}
        </div>

        <p className="drawer-desc">{s.description}</p>

        <section className="drawer-section">
          <h3>In a simulation</h3>
          <div className="drawer-role">
            <span className="role" style={{ "--role": role.hue } as CSSProperties}>
              {role.label}
            </span>
            <p>{roleExplained[s.simRole]}</p>
          </div>
        </section>

        <section className="drawer-section">
          <h3>Details</h3>
          <dl className="drawer-facts">
            <dt>Stencil id</dt>
            <dd>
              <button
                className="copy-chip"
                onClick={() => onCopy(s.id, "id")}
                title="Copy stencil id"
                data-testid="drawer-copy-id"
              >
                <span>{s.id}</span>
                <Icon name="copy" size={12} />
              </button>
            </dd>
            <dt>Category</dt>
            <dd>{categoryLabel[s.category] ?? s.category}</dd>
            <dt>Family</dt>
            <dd className="drawer-family">
              <i style={{ background: family.hue }} />
              {family.label}
            </dd>
            <dt>Accent</dt>
            <dd>
              <button
                className="copy-chip"
                onClick={() => onCopy(s.accent, "colour")}
                title="Copy accent colour"
                data-testid="drawer-copy-accent"
              >
                <i className="drawer-swatch" />
                <span>{s.accent.toLowerCase()}</span>
              </button>
            </dd>
            {s.defaultSublabel && (
              <>
                <dt>New nodes say</dt>
                <dd className="mono">{s.defaultSublabel}</dd>
              </>
            )}
            <dt>Icon</dt>
            <dd>
              {icon.source}
              <small>{icon.licence}</small>
            </dd>
          </dl>
        </section>
      </div>

      <footer className="drawer-foot">
        <button className="btn btn-primary" onClick={onAdd} data-testid="drawer-add">
          <Icon name="plus" size={14} /> Add to current diagram
        </button>
        <button className="btn" onClick={onNewDiagram} data-testid="drawer-new">
          New diagram with this
        </button>
        <button
          className="icon-btn"
          onClick={onCopyJson}
          aria-label="Copy as JSON node"
          title="Copy as JSON node"
          data-testid="drawer-copy-json"
        >
          <Icon name="copy" size={14} />
        </button>
      </footer>
    </div>
  );
}
