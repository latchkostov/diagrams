import { surfaceCatalogs } from "../i18n/surfaces";
import { observationPorts } from "../lib/observations";
import { currentObservationSource } from "../palette/observationSource";
import { getNodeVariant } from "./nodes/variantRegistry";
import { stencilLabel, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { stencilDescription } from "../i18n/stencilDescriptions";
import { tRich } from "../i18n/rich";
import { formatNumber } from "../i18n/number";
import { categoryLabel, familyLabel } from "../i18n/chrome";
import { t, useLocale } from "../i18n";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type DragEvent,
} from "react";
import { railAnchor } from "./railAnchor";
import { flushSync } from "react-dom";
import { DEFAULT_NODE_VARIANT, type NodeVariantId } from "../harness/nodeVariants";
import { getStencil, stencils } from "../stencils/registry";
import type { AnnotationKind, AnnotationShape, Stencil, StencilCategory } from "../model/types";
import { StencilIcon } from "../components/StencilIcon";
import { CATEGORY_ORDER, clientSections } from "../lib/categories";
import { familyCounts, familyOf, getFamily, isFamilyId, type FamilyId } from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { pushRecentStencil, useRecentStencils } from "../lib/recentStencils";
import { STENCIL_DND_MIME } from "../lib/canvasBridge";
import { Icon } from "../components/Icon";
import { safeStorage } from "../lib/storage";
import { formatCombo, shortcutKeys } from "../editor/shortcuts";
import { modalLayers } from "../lib/modalLayers";

import { AnnotateGroup } from "./AnnotateGroup";
import { matchAnnotate } from "./annotateSearch";

export { STENCIL_DND_MIME };

// Keep a modal's search-field return target mounted until it has handed focus back.
// eslint-disable-next-line react-refresh/only-export-components -- readiness belongs with the downloaded view
export async function paletteWhenReady() {
  await surfaceCatalogs(["stencils"]);
  while (modalLayers.top) {
    await new Promise<void>((resolve) => {
      const check = () => {
        if (modalLayers.top) return;
        modalLayers.listeners.delete(check);
        resolve();
      };
      modalLayers.listeners.add(check);
      check();
    });
  }
  return Palette;
}

const FAMILY_KEY = "diagrams.paletteFamily.v1";
const SECTIONS_KEY = "diagrams.paletteSections.v1";

function readFamily(): FamilyId | "all" {
  const v = safeStorage.getItem(FAMILY_KEY);
  return isFamilyId(v) ? v : "all";
}

/**
 * Folded categories. A first visit opens only the first (Messaging) so the rail reads as an overview
 * of categories with counts rather than 150 rows; search ignores folding, and choices are remembered.
 */
function readClosed(): StencilCategory[] {
  const stored = safeStorage.getItem(SECTIONS_KEY);
  if (stored === null) return CATEGORY_ORDER.slice(1);
  try {
    const v = JSON.parse(stored);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Left rail of stencils. Search first, then family, then collapsible categories; recents pinned on top.
 * Memoized: the canvas re-renders on every drag frame, selection and zoom; the rail has no reason to.
 */
export const Palette = memo(function Palette({
  collapsed,
  initialQuery = "",
  initialPick,
  mode = "pinned",
  onToggle,
  onAdd,
  onAnnotate,
  nodeVariant = DEFAULT_NODE_VARIANT,
}: {
  collapsed: boolean;
  initialQuery?: string;
  onInitialQuery?: (query: string) => void;
  initialPick?: string;
  onInitialPick?: (query: string | undefined) => void;
  mode?: "flyout" | "pinned";
  onToggle: () => void;
  onAdd: (stencilId: string) => void;
  /** Adds a text, note, zone or shape (the Annotate group). */
  onAnnotate?: (kind: AnnotationKind, shape?: AnnotationShape) => void;
  /** The canvas's node look, for the card a drag shows. */
  nodeVariant?: NodeVariantId;
}) {
  const locale = useLocale();
  const [q, setQ] = useState(initialQuery);
  const [family, setFamily] = useState<FamilyId | "all">(readFamily);
  const [closed, setClosed] = useState<StencilCategory[]>(readClosed);
  const recentIds = useRecentStencils();
  const preview = useDragPreview(nodeVariant);

  useEffect(() => {
    safeStorage.setItem(FAMILY_KEY, family);
  }, [family]);
  useEffect(() => {
    safeStorage.setItem(SECTIONS_KEY, JSON.stringify(closed));
  }, [closed]);

  const add = (id: string) => {
    pushRecentStencil(id);
    onAdd(id);
  };
  const item = { onAdd: add, onDrag: preview.start, onDragDone: preview.stop };

  const families = useMemo(() => familyCounts(stencils), []);
  const inFamily = useMemo(
    () => (family === "all" ? stencils : stencils.filter((s) => familyOf(s) === family)),
    [family],
  );
  const picked = useRef(false);
  useEffect(() => {
    if (collapsed || initialPick === undefined || picked.current) return;
    picked.current = true;
    const first = searchStencils(inFamily, initialPick)[0];
    if (first) {
      pushRecentStencil(first.id);
      onAdd(first.id);
    }
  }, [collapsed, initialPick, inFamily, onAdd]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared search metadata resolves the current locale
  const results = useMemo(() => (q.trim() ? searchStencils(inFamily, q) : null), [inFamily, q, locale]);
  const annotateHits = useMemo(() => (q.trim() ? matchAnnotate(q, locale) : []), [q, locale]);
  useLayoutEffect(() => {
    const source = currentObservationSource();
    if (source && !collapsed && q.trim())
      observationPorts.tools.publish({ ...source, query: q, stencils: results?.map((s) => s.id) ?? [] });
  }, [collapsed, q, results]);
  const common = useMemo(() => {
    const generic = stencils.filter((s) => familyOf(s) === "generic");
    const pick = (role: Stencil["simRole"], subtitle?: string) =>
      generic.find((s) => s.simRole === role && (!subtitle || s.defaultSublabel === subtitle));
    return [
      pick("processor", "service"),
      pick("store", "database"),
      pick("queue"),
      pick("topic"),
      pick("source", "user"),
      pick("gateway"),
      pick("store", "cache"),
      pick("sink", "api"),
    ].filter((s): s is Stencil => !!s);
  }, []);
  const groups = useMemo(() => {
    const map = new Map<StencilCategory, Stencil[]>();
    for (const s of inFamily) {
      if (family === "all" && common.includes(s)) continue;
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [inFamily, family, common]);
  const recent = useMemo(() => recentIds.map(getStencil).filter((s) => stencils.includes(s)), [recentIds]);

  const toggleSection = (c: StencilCategory) =>
    setClosed((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  if (collapsed) return null;

  const chosenFamily = family === "all" ? null : familyLabel[family];

  return (
    <aside
      className={mode === "flyout" ? "palette is-flyout" : "palette"}
      data-mode={mode}
      aria-label={t("topbar.stencils")}
      data-testid="palette"
    >
      {preview.node}
      <div className="palette-head">
        <div className="palette-head-row">
          <label className="field">
            <Icon name="search" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results?.[0]) {
                  e.preventDefault();
                  add(results[0].id);
                } else if (e.key === "Escape" && q) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQ("");
                }
              }}
              placeholder={t("library.findAStencil")}
              aria-label={t("library.findAStencil")}
              name="palette-search"
              autoComplete="off"
              spellCheck={false}
              data-testid="palette-search"
            />
            {q && (
              <button
                type="button"
                className="field-clear"
                onClick={() => setQ("")}
                aria-label={t("library.clearSearch")}
                data-testid="palette-search-clear"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
          <button
            className="icon-btn"
            onClick={onToggle}
            title={mode === "flyout" ? t("workbench.pin") : t("workbench.unpin")}
            aria-label={mode === "flyout" ? t("workbench.pin") : t("workbench.unpin")}
            data-testid="palette-toggle"
          >
            <Icon name={mode === "flyout" ? "pin" : "close"} />
          </button>
        </div>
        <label className="select select-quiet palette-family" title={t("library.showStencilsFromOneFamily")}>
          {family !== "all" && (
            <i className="palette-family-dot" style={{ background: getFamily(family).hue }} aria-hidden />
          )}
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value as FamilyId | "all")}
            aria-label={t("library.stencilFamily")}
            name="palette-family"
            data-testid="palette-family"
          >
            <option value="all">{t("chrome.allFamiliesValueOtherValue", { count: stencils.length })}</option>
            {families.map(({ family: f, count }) => (
              <option key={f.id} value={f.id}>
                {t("chrome.valueValueOtherValue", { name: familyLabel[f.id], count })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="palette-list">
        {results ? (
          <section data-testid="palette-results">
            <h3 className="palette-results-head">
              {results.length
                ? t("chrome.valueMatchOtherValueMatches", { count: results.length })
                : t("menu.noMatches")}
              {results.length > 0 && <span>{t("library.enterAddsTheFirst")}</span>}
            </h3>
            <div className="palette-grid">
              {results.map((s) => (
                <PaletteItem key={s.id} stencil={s} {...item} />
              ))}
            </div>
            {onAnnotate && annotateHits.length > 0 && (
              <AnnotateGroup items={annotateHits} onAdd={onAnnotate} className="is-results" />
            )}
            {results.length === 0 && annotateHits.length === 0 && (
              <div className="palette-empty" data-testid="palette-empty">
                <p>
                  {chosenFamily
                    ? t("chrome.nothingMatchesValueInValue", { query: q.trim(), family: chosenFamily })
                    : t("chrome.nothingMatchesValue", { query: q.trim() })}
                </p>
                {chosenFamily && (
                  <button className="link-btn" onClick={() => setFamily("all")} data-testid="palette-all-families">
                    {t("library.searchAllFamilies")}
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            {family === "all" && (
              <section data-testid="palette-common">
                <h3 className="palette-sec-static">{t("workbench.common")}</h3>
                <div className="palette-grid">
                  {common.map((s) => (
                    <PaletteItem key={s.id} stencil={s} {...item} />
                  ))}
                </div>
              </section>
            )}
            {recent.length > 0 && (
              <section className="palette-recent" data-testid="palette-recent">
                <h3 className="palette-sec-static">{t("menu.recentlyUsed")}</h3>
                <div className="palette-recent-grid">
                  {recent.map((s) => (
                    <RecentTile key={s.id} stencil={s} {...item} />
                  ))}
                </div>
              </section>
            )}
            {groups.map((g) => {
              const open = !closed.includes(g.category);
              return (
                <section key={g.category} className={`palette-sec${open ? "" : " is-closed"}`}>
                  <h3>
                    <button
                      className="palette-sec-head"
                      aria-expanded={open}
                      onClick={() => toggleSection(g.category)}
                      data-testid={`palette-section-${g.category}`}
                    >
                      <Icon name="chevron-right" size={12} />
                      <span>{categoryLabel[g.category]}</span>
                      <span className="palette-sec-count">{formatNumber(g.items.length, { useGrouping: false })}</span>
                    </button>
                  </h3>
                  {open && g.category === "clients"
                    ? clientSections(g.items).map((section) => (
                        <section key={section.id} data-testid={`palette-clients-${section.id}`}>
                          <h4 className="palette-sec-static">
                            {section.id === "sources" ? t("chrome.clientsWebhooks") : t("chrome.externalSystems")}
                          </h4>
                          <div className="palette-grid">
                            {section.items.map((s) => (
                              <PaletteItem key={s.id} stencil={s} {...item} />
                            ))}
                          </div>
                        </section>
                      ))
                    : open && (
                        <div className="palette-grid">
                          {g.items.map((s) => (
                            <PaletteItem key={s.id} stencil={s} {...item} />
                          ))}
                        </div>
                      )}
                </section>
              );
            })}
          </>
        )}
      </div>
      {/* Pinned under the list, so it's in view whatever is open above (searching lists matches instead). */}

      <PaletteFoot />
    </aside>
  );
});

/**
 * The rail's footer: how to add, or, with exactly one node selected, that a click adds after it (decision 4).
 * It follows the selection by itself, so selecting never re-renders the rail.
 */
function PaletteFoot() {
  useLocale();
  const after = useSyncExternalStore(railAnchor.subscribe, railAnchor.get, railAnchor.get);
  return (
    <div className="palette-foot">
      {after ? (
        <span data-testid="palette-after">
          {tRich("library.aClickAddsAfterBValueBConnectedDragTo", {
            name: after,
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </span>
      ) : (
        tRich("library.addingAndShortcuts", {
          paletteCombo: formatCombo(shortcutKeys("command-palette")),
          palette: (chunks) => <kbd>{chunks}</kbd>,
          shortcuts: (chunks) => <kbd>{chunks}</kbd>,
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Annotate

interface ItemProps {
  stencil: Stencil;
  onAdd: (id: string) => void;
  /** Builds the node-card picture the drag shows; returns it (null: none). */
  onDrag: (s: Stencil) => HTMLElement | null;
  onDragDone: () => void;
}

function dragHandlers({ stencil: s, onAdd, onDrag, onDragDone }: ItemProps) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(STENCIL_DND_MIME, s.id);
      e.dataTransfer.effectAllowed = "copy";
      // A node card at the canvas's zoom, not the browser's picture of this row.
      const card = onDrag(s);
      if (card) {
        const r = card.getBoundingClientRect();
        e.dataTransfer.setDragImage(card, r.width / 2, r.height / 2);
      }
    },
    onDragEnd: (e: DragEvent) => {
      onDragDone();
      // Only a drop the canvas accepted counts as "used".
      if (e.dataTransfer.dropEffect !== "none") pushRecentStencil(s.id);
    },
    onClick: () => onAdd(s.id),
  };
}

/**
 * The picture a stencil drag shows (D13): the node card it will make, at the canvas's zoom. Rendered
 * offscreen for the length of the drag, since the browser snapshots it when the drag starts.
 */
function useDragPreview(nodeVariant: NodeVariantId) {
  const [drag, setDrag] = useState<{ stencil: Stencil; zoom: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const { Component } = getNodeVariant(nodeVariant);
  const start = (s: Stencil) => {
    const wrap = document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]');
    const zoom = Number(wrap?.style.getPropertyValue("--rf-zoom")) || 1;
    flushSync(() => setDrag({ stencil: s, zoom }));
    return ref.current;
  };
  const stop = () => setDrag(null);
  const stencil = drag?.stencil;
  const node =
    drag && stencil ? (
      <div
        ref={ref}
        className={`stencil-drag-preview dn dn-${nodeVariant}`}
        style={{ zoom: drag.zoom, "--accent": stencil.accent } as CSSProperties}
        aria-hidden
        data-testid="stencil-drag-preview"
      >
        <Component
          stencil={stencil}
          stencilName={stencilLabel(stencil)}
          label={stencilLabel(stencil)}
          sublabel={stencilSubtitle(stencil)}
        />
      </div>
    ) : null;
  return { start, stop, node };
}

function PaletteItem(p: ItemProps) {
  const s = p.stencil;
  return (
    <button
      className="palette-item"
      {...dragHandlers(p)}
      title={`${stencilLabel(s)} (${vendorLabel(s.vendor)})\n${stencilDescription(s)}`}
      data-testid={`palette-item-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <span className="palette-tile">
        <StencilIcon stencil={s} size={20} loading="lazy" />
      </span>
      <span className="palette-name">{stencilLabel(s)}</span>
      <span className="palette-add" aria-hidden>
        <Icon name="plus" size={12} />
      </span>
    </button>
  );
}

function RecentTile(p: ItemProps) {
  const s = p.stencil;
  return (
    <button
      className="palette-recent-item"
      {...dragHandlers(p)}
      title={`${stencilLabel(s)} (${vendorLabel(s.vendor)})`}
      aria-label={t("chrome.addValue", { name: stencilLabel(s) })}
      data-testid={`palette-recent-item-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <StencilIcon stencil={s} size={20} loading="lazy" />
    </button>
  );
}
