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
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { familyCounts, familyOf, getFamily, isFamilyId, type FamilyId } from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilSearch";
import { pushRecentStencil, useRecentStencils } from "../lib/recentStencils";
import { rememberCanvas, STENCIL_DND_MIME, takePendingStencils } from "../lib/canvasBridge";
import { Icon, type IconName } from "../components/Icon";
import { safeStorage } from "../lib/storage";
import { formatCombo, shortcutKeys } from "../editor/shortcuts";
import { ANNOTATION_DND_MIME, annotationDragValue, shapeLabel } from "./annotations";

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
  const results = useMemo(() => (q.trim() ? searchStencils(inFamily, q) : null), [inFamily, q]);
  const annotateHits = useMemo(() => (q.trim() ? matchAnnotate(q) : []), [q]);
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
      <aside className="palette is-collapsed" aria-label="Stencils" data-testid="palette">
        <button
          className="icon-btn"
          onClick={onToggle}
          title="Show stencils"
          aria-label="Show stencils"
          data-testid="palette-toggle"
        >
          <Icon name="panel" />
        </button>
        {preview.node}
        {recent.length > 0 && (
          <div className="palette-rail-recent" aria-label="Recently used stencils">
            {recent.map((s) => (
              <RecentTile key={s.id} stencil={s} {...item} />
            ))}
          </div>
        )}
      </aside>
    );
  }

  const familyLabel = family === "all" ? null : getFamily(family).label;

  return (
    <aside className="palette" aria-label="Stencils" data-testid="palette">
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
              placeholder="Find a stencil"
              aria-label="Find a stencil"
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
                aria-label="Clear search"
                data-testid="palette-search-clear"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </label>
          <button
            className="icon-btn"
            onClick={onToggle}
            title="Hide stencils"
            aria-label="Hide stencils"
            data-testid="palette-toggle"
          >
            <Icon name="panel" />
          </button>
        </div>
        <label className="select select-quiet palette-family" title="Show stencils from one family">
          {family !== "all" && (
            <i className="palette-family-dot" style={{ background: getFamily(family).hue }} aria-hidden />
          )}
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value as FamilyId | "all")}
            aria-label="Stencil family"
            name="palette-family"
            data-testid="palette-family"
          >
            <option value="all">All families ({stencils.length})</option>
            {families.map(({ family: f, count }) => (
              <option key={f.id} value={f.id}>
                {f.label} ({count})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="palette-list">
        {results ? (
          <section data-testid="palette-results">
            <h3 className="palette-results-head">
              {results.length ? `${results.length} ${results.length === 1 ? "match" : "matches"}` : "No matches"}
              {results.length > 0 && <span>Enter adds the first</span>}
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
                  Nothing matches “{q.trim()}”{familyLabel ? ` in ${familyLabel}` : ""}.
                </p>
                {familyLabel && (
                  <button className="link-btn" onClick={() => setFamily("all")} data-testid="palette-all-families">
                    Search all families
                  </button>
                )}
              </div>
            )}
          </section>
        ) : (
          <>
            {recent.length > 0 && (
              <section className="palette-recent" data-testid="palette-recent">
                <h3 className="palette-sec-static">Recently used</h3>
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
                      <span className="palette-sec-count">{g.items.length}</span>
                    </button>
                  </h3>
                  {open && (
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
  const after = useSyncExternalStore(railAnchor.subscribe, railAnchor.get, railAnchor.get);
  return (
    <div className="palette-foot">
      {after ? (
        <span data-testid="palette-after">
          A click adds after <strong>{after}</strong>, connected. Drag to place it anywhere.
        </span>
      ) : (
        <>
          Drag onto the canvas or click to add. <kbd>{formatCombo(shortcutKeys("command-palette"))}</kbd> finds
          anything; <kbd>?</kbd> lists shortcuts.
        </>
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
    label: "Text",
    icon: "type",
    hint: "Plain text: titles and captions (T)",
    keywords: "title caption label words",
  },
  { kind: "note", label: "Note", icon: "note", hint: "A sticky note", keywords: "sticky comment post-it" },
  {
    kind: "zone",
    label: "Zone",
    icon: "zone",
    hint: "A labelled region behind nodes. Unlike a boundary, nodes don't move with it",
    keywords: "region area lane band highlight",
  },
];

/** The rail's row: one tile per kind. A shape starts as a rectangle; the inspector changes its outline. */
const ANNOTATE: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
  {
    kind: "shape",
    label: "Shape",
    icon: "shape-rect",
    hint: "A plain shape for when no stencil fits: rectangle, ellipse, diamond, cylinder",
    keywords: "shape outline rectangle box",
  },
];

/** What search finds: each outline by name, so "ellipse" or "cylinder" adds that one directly. */
const ANNOTATE_SEARCH: readonly AnnotateItem[] = [
  ...TEXT_NOTE_ZONE,
  ...(["rect", "rounded", "ellipse", "diamond", "cylinder"] as const).map((shape) => ({
    kind: "shape" as const,
    shape,
    label: shapeLabel[shape].replace(" rectangle", ""),
    icon: `shape-${shape}` as IconName,
    hint: `${shapeLabel[shape]}: a plain shape for when no stencil fits`,
    keywords: `shape outline ${shapeLabel[shape]}${shape === "rect" ? " box" : ""}`,
  })),
];

function matchAnnotate(q: string): AnnotateItem[] {
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
  return (
    <section className={`palette-annotate ${className}`} data-testid="palette-annotate">
      <h3 className="palette-sec-static" title="Text, notes, zones and shapes. They don't take part in the simulation">
        Annotate
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
              aria-label={`Add ${a.shape ? shapeLabel[a.shape].toLowerCase() : a.label.toLowerCase()}`}
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
        <Component stencil={stencil} label={stencil.label} sublabel={stencil.defaultSublabel} />
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
      title={`${s.label} (${s.vendor})\n${s.description}`}
      data-testid={`palette-item-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <span className="palette-tile">
        <StencilIcon stencil={s} size={20} />
      </span>
      <span className="palette-name">{s.label}</span>
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
      title={`${s.label} (${s.vendor})`}
      aria-label={`Add ${s.label}`}
      data-testid={`palette-recent-item-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <StencilIcon stencil={s} size={20} />
    </button>
  );
}
