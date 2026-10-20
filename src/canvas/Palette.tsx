import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { tRich } from "../i18n/rich";
import { formatNumber } from "../i18n/number";
import { categoryLabel, shapeLabel, familyLabel } from "../i18n/chrome";
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
import { DEFAULT_NODE_VARIANT, getNodeVariant, type NodeVariantId } from "../harness/nodeVariants";
import { getStencil, stencils } from "../stencils/registry";
import type { AnnotationKind, AnnotationShape, Stencil, StencilCategory } from "../model/types";
import { StencilIcon } from "../components/StencilIcon";
import { CATEGORY_ORDER, clientSections } from "../lib/categories";
import { familyCounts, familyOf, getFamily, isFamilyId, type FamilyId } from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilDisplaySearch";
import { pushRecentStencil, useRecentStencils } from "../lib/recentStencils";
import { rememberCanvas, STENCIL_DND_MIME, takePendingStencils } from "../lib/canvasBridge";
import { Icon, type IconName } from "../components/Icon";
import { safeStorage } from "../lib/storage";
import { formatCombo, shortcutKeys } from "../editor/shortcuts";
import { ANNOTATION_DND_MIME, annotationDragValue } from "./annotations";
import { SHAPES_CATALOG } from "./shapes/catalog";

export { STENCIL_DND_MIME };

const FAMILY_KEY = "diagrams.paletteFamily.v1";
const SECTIONS_KEY = "diagrams.paletteSections.v1";
/** Long enough for React Flow's initial fitView, so "viewport centre" means the fitted view. */
const PENDING_DELAY = 260;

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
  onToggle,
  onAdd,
  onAnnotate,
  nodeVariant = DEFAULT_NODE_VARIANT,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onAdd: (stencilId: string) => void;
  /** Adds a text, note, zone or shape (the Annotate group). */
  onAnnotate?: (kind: AnnotationKind, shape?: AnnotationShape) => void;
  /** The canvas's node look, for the card a drag shows. */
  nodeVariant?: NodeVariantId;
}) {
  const locale = useLocale();
  const [q, setQ] = useState("");
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

  const onAddRef = useRef(onAdd);
  useLayoutEffect(() => {
    onAddRef.current = onAdd;
  });

  // Stencils sent from the Gallery ("Add to current diagram"), and which diagram is "current".
  useEffect(() => {
    const t = setTimeout(() => {
      const slug = new URLSearchParams(window.location.search).get("example");
      if (slug) rememberCanvas(slug);
      for (const id of takePendingStencils()) onAddRef.current(id);
    }, PENDING_DELAY);
    return () => clearTimeout(t);
    // Mount only: the queue is drained once per canvas.
  }, []);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared search metadata resolves the current locale
  const results = useMemo(() => (q.trim() ? searchStencils(inFamily, q) : null), [inFamily, q, locale]);
  const annotateHits = useMemo(() => (q.trim() ? matchAnnotate(q, locale) : []), [q, locale]);
  const groups = useMemo(() => {
    const map = new Map<StencilCategory, Stencil[]>();
    for (const s of inFamily) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [inFamily]);
  const recent = useMemo(() => recentIds.map(getStencil).filter((s) => stencils.includes(s)), [recentIds]);

  const toggleSection = (c: StencilCategory) =>
    setClosed((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  if (collapsed) {
    return (
      <aside className="palette is-collapsed" aria-label={t("topbar.stencils")} data-testid="palette">
        <button
          className="icon-btn"
          onClick={onToggle}
          title={t("library.showStencils")}
          aria-label={t("library.showStencils")}
          data-testid="palette-toggle"
        >
          <Icon name="panel" />
        </button>
        {preview.node}
        {recent.length > 0 && (
          <div className="palette-rail-recent" aria-label={t("library.recentlyUsedStencils")}>
            {recent.map((s) => (
              <RecentTile key={s.id} stencil={s} {...item} />
            ))}
          </div>
        )}
      </aside>
    );
  }

  const chosenFamily = family === "all" ? null : familyLabel[family];

  return (
    <aside className="palette" aria-label={t("topbar.stencils")} data-testid="palette">
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
            title={t("library.hideStencils")}
            aria-label={t("library.hideStencils")}
            data-testid="palette-toggle"
          >
            <Icon name="panel" />
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
      {onAnnotate && !results && <AnnotateGroup items={ANNOTATE} onAdd={onAnnotate} className="is-pinned" />}
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

interface AnnotateItem {
  kind: AnnotationKind;
  shape?: AnnotationShape;
  label: string;
  icon: IconName;
  hint: string;
  keywords: string;
}

const TEXT_NOTE_ZONE: readonly AnnotateItem[] = [
  {
    kind: "text",
    get label() {
      return t("library.text");
    },
    icon: "type",
    get hint() {
      return t("library.plainTextTitlesAndCaptionsT");
    },
    keywords: "title caption label words",
  },
  {
    kind: "note",
    get label() {
      return t("library.note");
    },
    icon: "note",
    get hint() {
      return t("library.aStickyNote");
    },
    keywords: "sticky comment post-it",
  },
  {
    kind: "zone",
    get label() {
      return t("library.zone");
    },
    icon: "zone",
    get hint() {
      return t("library.aLabelledRegionBehindNodesUnlikeABoundaryNodesDon");
    },
    keywords: "region area lane band highlight",
  },
];

/** The rail's row: one tile per kind. A shape starts as a rectangle; the inspector changes its outline. */
const ANNOTATE: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
  {
    kind: "shape",
    get label() {
      return t("menu.shape");
    },
    icon: "shape-rect",
    get hint() {
      return t("library.aPlainShapeForWhenNoStencilFitsRectangleEllipse");
    },
    keywords: "shape outline rectangle box",
  },
];

/** What search finds: each outline by name, so "ellipse" or "cylinder" adds that one directly. */
const ANNOTATE_SEARCH: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
  ...SHAPES_CATALOG.map((s) => ({
    kind: "shape" as const,
    shape: s.id,
    get label() {
      return s.id === "rounded" ? t("chrome.rounded") : s.label;
    },
    icon: `shape-${s.id}` as IconName,
    get hint() {
      return t("chrome.valueAPlainShapeForWhenNoStencilFits", { shape: s.label });
    },
    get keywords() {
      return `shape outline ${s.label} ${s.keywords}${s.id === "rect" ? " box" : ""}`;
    },
  })),
];

function matchAnnotate(q: string, _locale: string): AnnotateItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return ANNOTATE_SEARCH.filter((a) => {
    const hay = `${a.label} ${a.kind} ${a.keywords} annotate annotation`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Text, notes, zones and shapes: documentation that never takes part in the simulation. */
function AnnotateGroup({
  items,
  onAdd,
  className,
}: {
  items: readonly AnnotateItem[];
  onAdd: (kind: AnnotationKind, shape?: AnnotationShape) => void;
  className: string;
}) {
  useLocale();
  return (
    <section className={`palette-annotate ${className}`} data-testid="palette-annotate">
      <h3 className="palette-sec-static" title={t("library.textNotesZonesAndShapesTheyDonTTakePart")}>
        {t("menu.annotate")}
      </h3>
      <div className="palette-annotate-grid">
        {items.map((a) => {
          const id = a.shape ? `shape-${a.shape}` : a.kind;
          return (
            <button
              key={id}
              className="palette-annotate-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ANNOTATION_DND_MIME, annotationDragValue(a.kind, a.shape));
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(a.kind, a.shape)}
              title={a.hint}
              aria-label={t("chrome.addValue", {
                name: a.shape ? shapeLabel[a.shape].toLowerCase() : a.label.toLowerCase(),
              })}
              data-testid={`palette-annotate-${id}`}
            >
              <Icon name={a.icon} size={18} />
              <span>{a.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

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
        <StencilIcon stencil={s} size={20} />
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
      <StencilIcon stencil={s} size={20} />
    </button>
  );
}
