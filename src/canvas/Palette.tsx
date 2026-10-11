import { useMemo, useState, type CSSProperties } from "react";
import { stencils } from "../stencils/registry";
import type { StencilCategory } from "../model/types";
import { StencilIcon } from "../components/StencilIcon";
import { CATEGORY_ORDER, categoryLabel } from "../lib/categories";
import { Icon } from "../components/Icon";

export const STENCIL_DND_MIME = "application/x-diagrams-stencil";

/** Left rail of stencils. Drag onto the canvas, or click to drop one in the middle of the view. */
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
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const map = new Map<StencilCategory, typeof stencils[number][]>();
    for (const s of stencils) {
      const hay = `${s.label} ${s.vendor} ${s.id}`.toLowerCase();
      if (needle && !hay.includes(needle)) continue;
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [q]);

  if (collapsed) {
    return (
      <aside className="palette is-collapsed" data-testid="palette">
        <button className="icon-btn" onClick={onToggle} title="Show stencils" aria-label="Show stencils" data-testid="palette-toggle">
          <Icon name="panel" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="palette" data-testid="palette">
      <div className="palette-head">
        <div className="field">
          <Icon name="search" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a stencil"
            aria-label="Find a stencil"
            name="palette-search"
            data-testid="palette-search"
          />
        </div>
        <button className="icon-btn" onClick={onToggle} title="Hide stencils" aria-label="Hide stencils" data-testid="palette-toggle">
          <Icon name="panel" />
        </button>
      </div>
      <div className="palette-list">
        {groups.map((g) => (
          <section key={g.category}>
            <h3>{categoryLabel[g.category]}</h3>
            <div className="palette-grid">
              {g.items.map((s) => (
                <button
                  key={s.id}
                  className="palette-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(STENCIL_DND_MIME, s.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => onAdd(s.id)}
                  title={`${s.label} (${s.vendor})\n${s.description}`}
                  data-testid={`palette-item-${s.id}`}
                  style={{ "--accent": s.accent } as CSSProperties}
                >
                  <span className="palette-tile">
                    <StencilIcon stencil={s} size={20} />
                  </span>
                  <span className="palette-name">{s.label}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {groups.length === 0 && <p className="palette-empty">Nothing matches “{q}”.</p>}
      </div>
      <div className="palette-foot">
        Drag onto the canvas, or double-click the canvas to search. Right-click anything for actions; press <kbd>?</kbd> for shortcuts.
      </div>
    </aside>
  );
}
