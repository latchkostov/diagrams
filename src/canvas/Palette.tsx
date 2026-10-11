import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { getStencil, stencils } from "../stencils/registry";
import type { Stencil, StencilCategory } from "../model/types";
import { StencilIcon } from "../components/StencilIcon";
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { familyCounts, familyOf, getFamily, isFamilyId, type FamilyId } from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilSearch";
import { pushRecentStencil, useRecentStencils } from "../lib/recentStencils";
import { rememberCanvas, STENCIL_DND_MIME, takePendingStencils } from "../lib/canvasBridge";
import { Icon } from "../components/Icon";
import { safeStorage } from "../lib/storage";
import { formatCombo, shortcutKeys } from "../editor/shortcuts";

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

/** Left rail of stencils. Search first, then family, then collapsible categories; recents pinned on top. */
export function Palette({
  collapsed,
  onToggle,
  onAdd,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onAdd: (stencilId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<FamilyId | "all">(readFamily);
  const [closed, setClosed] = useState<StencilCategory[]>(readClosed);
  const recentIds = useRecentStencils();

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

  const families = useMemo(() => familyCounts(stencils), []);
  const inFamily = useMemo(
    () => (family === "all" ? stencils : stencils.filter((s) => familyOf(s) === family)),
    [family],
  );
  const results = useMemo(() => (q.trim() ? searchStencils(inFamily, q) : null), [inFamily, q]);
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
      <aside className="palette is-collapsed" data-testid="palette">
        <button
          className="icon-btn"
          onClick={onToggle}
          title="Show stencils"
          aria-label="Show stencils"
          data-testid="palette-toggle"
        >
          <Icon name="panel" />
        </button>
        {recent.length > 0 && (
          <div className="palette-rail-recent" aria-label="Recently used stencils">
            {recent.map((s) => (
              <RecentTile key={s.id} stencil={s} onAdd={add} />
            ))}
          </div>
        )}
      </aside>
    );
  }

  const familyLabel = family === "all" ? null : getFamily(family).label;

  return (
    <aside className="palette" data-testid="palette">
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
                <PaletteItem key={s.id} stencil={s} onAdd={add} />
              ))}
            </div>
            {results.length === 0 && (
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
                    <RecentTile key={s.id} stencil={s} onAdd={add} />
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
                        <PaletteItem key={s.id} stencil={s} onAdd={add} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
      <div className="palette-foot">
        Drag onto the canvas or click to add. <kbd>{formatCombo(shortcutKeys("command-palette"))}</kbd> finds anything;{" "}
        <kbd>?</kbd> lists shortcuts.
      </div>
    </aside>
  );
}

function dragHandlers(s: Stencil, onAdd: (id: string) => void) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(STENCIL_DND_MIME, s.id);
      e.dataTransfer.effectAllowed = "copy";
    },
    onDragEnd: (e: DragEvent) => {
      // Only a drop the canvas accepted counts as "used".
      if (e.dataTransfer.dropEffect !== "none") pushRecentStencil(s.id);
    },
    onClick: () => onAdd(s.id),
  };
}

function PaletteItem({ stencil: s, onAdd }: { stencil: Stencil; onAdd: (id: string) => void }) {
  return (
    <button
      className="palette-item"
      {...dragHandlers(s, onAdd)}
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

function RecentTile({ stencil: s, onAdd }: { stencil: Stencil; onAdd: (id: string) => void }) {
  return (
    <button
      className="palette-recent-item"
      {...dragHandlers(s, onAdd)}
      title={`${s.label} (${s.vendor})`}
      aria-label={`Add ${s.label}`}
      data-testid={`palette-recent-item-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
    >
      <StencilIcon stencil={s} size={20} />
    </button>
  );
}
