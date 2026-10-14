import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { categoryLabel, familyLabel } from "../i18n/chrome";
import { t, useLocale } from "../i18n";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Stencil } from "../model/types";
import { nodeVariants, type NodeVariantId } from "../harness/nodeVariants";
import {} from "../lib/categories";
import { galleryRoleMeta as simRoleMeta } from "../i18n/galleryRoles";
import { familyOf, getFamily } from "../lib/vendorFamilies";
import { Icon } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import { iconSource, roleExplained } from "./stencilInfo";

const variantLabel: Record<NodeVariantId, () => string> = {
  card: () => t("view.node.card"),
  compact: () => t("view.node.compact"),
  iconOnly: () => t("view.node.iconOnly"),
};

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
  useLocale();
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
        const nextKey = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
        onStep(e.key === nextKey ? 1 : -1);
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
          <h2 id="drawer-title">{stencilLabel(s)}</h2>
          <span>{vendorLabel(s.vendor)}</span>
        </div>
        <div className="drawer-nav">
          <button
            className="icon-btn icon-btn-quiet"
            onClick={() => onStep(-1)}
            disabled={total < 2}
            aria-label={t("gallery.previousStencil")}
            title={t("gallery.previous")}
            data-testid="drawer-prev"
          >
            <Icon name="chevron-right" size={14} />
          </button>
          <span className="drawer-pos" aria-live="polite">
            {t("chrome.valueOfValueOtherValue", { index: index + 1, total })}
          </span>
          <button
            className="icon-btn icon-btn-quiet"
            onClick={() => onStep(1)}
            disabled={total < 2}
            aria-label={t("gallery.nextStencil")}
            title={t("gallery.next")}
            data-testid="drawer-next"
          >
            <Icon name="chevron-right" size={14} />
          </button>
          <button
            className="icon-btn icon-btn-quiet"
            onClick={onClose}
            aria-label={t("gallery.closeDetails")}
            title={t("gallery.closeEsc")}
            data-testid="drawer-close"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </header>

      <div className="drawer-body">
        <div className="drawer-stage" data-testid="drawer-preview">
          {Object.entries(nodeVariants).map(([id, v]) => (
            <figure key={id} className={`drawer-variant variant-${id}`} data-testid={`drawer-preview-${id}`}>
              <div className="drawer-variant-node">
                <v.Component
                  stencil={s}
                  stencilName={stencilLabel(s)}
                  label={stencilLabel(s)}
                  sublabel={stencilSubtitle(s)}
                />
              </div>
              <figcaption data-testid={`drawer-variant-${id}`}>{variantLabel[id as NodeVariantId]()}</figcaption>
            </figure>
          ))}
        </div>

        <p className="drawer-desc">{stencilDescription(s)}</p>

        <section className="drawer-section">
          <h3>{t("gallery.inASimulation")}</h3>
          <div className="drawer-role">
            <span className="role" style={{ "--role": role.hue } as CSSProperties}>
              {role.label}
            </span>
            <p>{roleExplained[s.simRole]}</p>
          </div>
        </section>

        <section className="drawer-section">
          <h3>{t("fileToast.details")}</h3>
          <dl className="drawer-facts">
            <dt>{t("gallery.stencilId")}</dt>
            <dd>
              <button
                className="copy-chip"
                onClick={() => onCopy(s.id, t("chrome.id"))}
                title={t("gallery.copyStencilId")}
                data-testid="drawer-copy-id"
              >
                <span>{s.id}</span>
                <Icon name="copy" size={12} />
              </button>
            </dd>
            <dt>{t("gallery.category")}</dt>
            <dd>{categoryLabel[s.category] ?? s.category}</dd>
            <dt>{t("gallery.family")}</dt>
            <dd className="drawer-family">
              <i style={{ background: family.hue }} />
              {familyLabel[family.id]}
            </dd>
            <dt>{t("gallery.accent")}</dt>
            <dd>
              <button
                className="copy-chip"
                onClick={() => onCopy(s.accent, t("chrome.colour"))}
                title={t("gallery.copyAccentColour")}
                data-testid="drawer-copy-accent"
              >
                <i className="drawer-swatch" />
                <span>{s.accent.toLowerCase()}</span>
              </button>
            </dd>
            {s.defaultSublabel && (
              <>
                <dt>{t("gallery.newNodesSay")}</dt>
                <dd className="mono">{stencilSubtitle(s)}</dd>
              </>
            )}
            <dt>{t("view.node.iconOnly")}</dt>
            <dd>
              {icon.source}
              <small>{icon.licence}</small>
            </dd>
          </dl>
        </section>
      </div>

      <footer className="drawer-foot">
        <button className="btn btn-primary" onClick={onAdd} data-testid="drawer-add">
          <Icon name="plus" size={14} />
          {t("gallery.addToCurrentDiagramText")}
        </button>
        <button className="btn" onClick={onNewDiagram} data-testid="drawer-new">
          {t("gallery.newDiagramWithThis")}
        </button>
        <button
          className="icon-btn"
          onClick={onCopyJson}
          aria-label={t("gallery.copyAsJSONNode")}
          title={t("gallery.copyAsJSONNode")}
          data-testid="drawer-copy-json"
        >
          <Icon name="copy" size={14} />
        </button>
      </footer>
    </div>
  );
}
