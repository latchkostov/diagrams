import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { iconUrl, stencils } from "../stencils/registry";
import type { Stencil, StencilCategory } from "../model/types";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { CATEGORY_ORDER, categoryBlurb, categoryLabel } from "../lib/categories";
import { simRoleMeta } from "../lib/simRoles";
import {
  familyCounts,
  familyOf,
  familyOfVendor,
  getFamily,
  vendorsByFamily,
  type FamilyId,
} from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilSearch";
import { addToCurrentDiagram, nodeJson, openNewDiagramWith, STENCIL_DND_MIME } from "../lib/canvasBridge";
import type { MenuNode } from "../editor/actions";
import { ContextMenu } from "../components/ContextMenu";
import { Icon } from "../components/Icon";
import { StencilDrawer } from "./StencilDrawer";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

type Menu = { x: number; y: number; items: MenuNode[]; label: string; testId: string; searchable?: string };

/** Every stencil, as metadata and as a real diagram node. Click for details, drag or right-click to use one. */
export function GalleryView() {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState<FamilyId | "all">("all");
  const [vendor, setVendor] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<StencilCategory | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const lastTile = useRef<string | null>(null);
  const closeDetail = useCallback(() => {
    setDetail(null);
    const id = lastTile.current;
    if (id)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>(`[data-testid="stencil-tile-${CSS.escape(id)}"]`)
          ?.focus({ preventScroll: true }),
      );
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(document.activeElement instanceof HTMLInputElement) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!detail || menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(document.activeElement instanceof HTMLInputElement)) closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, menu, closeDetail]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 1800);
    return () => clearTimeout(t);
  }, [note]);

  const vendorCount = useMemo(() => new Set(stencils.map((s) => s.vendor)).size, []);
  const families = useMemo(() => familyCounts(stencils), []);

  // Search narrows first, so the family counts say how many hits each family holds.
  const searched = useMemo(() => searchStencils(stencils, q), [q]);
  const searchedFamilies = useMemo(() => {
    const m = new Map<FamilyId, number>();
    for (const s of searched) m.set(familyOf(s), (m.get(familyOf(s)) ?? 0) + 1);
    return m;
  }, [searched]);

  const filtered = useMemo(
    () => searched.filter((s) => (vendor ? s.vendor === vendor : family === "all" || familyOf(s) === family)),
    [searched, family, vendor],
  );

  const sections = useMemo(() => {
    const map = new Map<StencilCategory, Stencil[]>();
    // Group in catalog order inside each category (search ranking matters less than a stable grid).
    const order = new Map(stencils.map((s, i) => [s.id, i]));
    for (const s of [...filtered].sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    const cats = [...CATEGORY_ORDER, ...[...map.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return cats.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [filtered]);

  /** Results in display order, for the drawer's previous / next. */
  const ordered = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Highlight the rail entry for the section at the top of the scroll area.
  useEffect(() => {
    const root = main.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveSection(top.target.getAttribute("data-category") as StencilCategory);
      },
      { root, rootMargin: "-140px 0px -55% 0px" },
    );
    root.querySelectorAll("[data-category]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [sections]);

  const missingIcons = useMemo(() => stencils.filter((s) => !iconUrl(s.icon)).length, []);

  const copy = useCallback((text: string, what: string) => {
    const done = () => setNote(`Copied ${what}`);
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(done, () => setNote("Couldn't reach the clipboard"));
    else setNote("Couldn't reach the clipboard");
  }, []);
  const copyJson = useCallback((s: Stencil) => copy(JSON.stringify(nodeJson(s), null, 2), "JSON node"), [copy]);

  const openDetail = (id: string) => {
    lastTile.current = id;
    setDetail(id);
  };
  const detailStencil = detail ? stencils.find((s) => s.id === detail) : undefined;
  const detailIndex = detailStencil ? ordered.findIndex((s) => s.id === detailStencil.id) : -1;
  const step = (dir: 1 | -1) => {
    if (!ordered.length) return;
    const i = detailIndex < 0 ? 0 : (detailIndex + dir + ordered.length) % ordered.length;
    lastTile.current = ordered[i].id;
    setDetail(ordered[i].id);
    document
      .querySelector(`[data-testid="stencil-tile-${CSS.escape(ordered[i].id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const tileMenu = (s: Stencil, x: number, y: number) =>
    setMenu({
      x,
      y,
      label: `${s.label} menu`,
      testId: "tile-menu",
      items: [
        {
          type: "item",
          id: "tile-add",
          label: "Add to current diagram",
          icon: "plus",
          run: () => addToCurrentDiagram(s.id),
        },
        { type: "item", id: "tile-details", label: "View details", icon: "info", run: () => openDetail(s.id) },
        { type: "separator" },
        { type: "item", id: "tile-copy-id", label: "Copy id", icon: "copy", hint: s.id, run: () => copy(s.id, "id") },
        { type: "item", id: "tile-copy-json", label: "Copy as JSON node", icon: "copy", run: () => copyJson(s) },
      ],
    });

  const openVendorMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Families at the top level, vendors one level down: short enough to open below the button,
    // and the search box still finds any vendor directly.
    const items: MenuNode[] = [
      {
        type: "item",
        id: "vendor:all",
        label: "All vendors",
        checked: vendor === null,
        hint: String(stencils.length),
        run: () => pickFamily("all"),
      },
      { type: "separator" },
    ];
    for (const g of vendorsByFamily(stencils)) {
      items.push({
        type: "item",
        id: `vendor-family:${g.family.id}`,
        label: g.family.label,
        swatch: g.family.hue,
        hint: `${g.vendors.length} ${g.vendors.length === 1 ? "vendor" : "vendors"}`,
        checked: !!vendor && familyOfVendor(vendor) === g.family.id,
        children: g.vendors.map((v) => ({
          type: "item" as const,
          id: `vendor:${slugify(v.vendor)}`,
          label: v.vendor,
          hint: String(v.count),
          checked: vendor === v.vendor,
          run: () => {
            setVendor(v.vendor);
            setFamily(familyOfVendor(v.vendor));
            main.current?.scrollTo({ top: 0 });
          },
        })),
      });
    }
    const width = 280;
    setMenu({
      x: Math.max(8, r.right - width),
      y: r.bottom + 6,
      items,
      label: "Filter by vendor",
      testId: "vendor-menu",
      searchable: "Find a vendor",
    });
  };

  const pickFamily = (f: FamilyId | "all") => {
    setVendor(null);
    setFamily(f);
    main.current?.scrollTo({ top: 0 });
  };

  const clearAll = () => {
    setQ("");
    setVendor(null);
    setFamily("all");
  };

  const scope = vendor ?? (family === "all" ? null : getFamily(family).label);

  return (
    <div
      className="gallery"
      data-testid="gallery-view"
      onContextMenu={(e) => {
        // The app owns right-click; the search box keeps the native menu (paste, spellcheck).
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      <nav className="gallery-rail" aria-label="Categories">
        <div className="rail-title">Categories</div>
        {CATEGORY_ORDER.map((c) => {
          const n = sections.find((s) => s.category === c)?.items.length ?? 0;
          return (
            <button
              key={c}
              className={`rail-link${activeSection === c && n ? " is-on" : ""}`}
              disabled={!n}
              aria-current={activeSection === c && n ? "location" : undefined}
              onClick={() =>
                document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              data-testid={`rail-${c}`}
            >
              <span>{categoryLabel[c]}</span>
              <span className="rail-count">{n}</span>
            </button>
          );
        })}
        <div className="rail-legend">
          <div className="rail-title">Simulation roles</div>
          {Object.entries(simRoleMeta).map(([role, m]) => (
            <div key={role} className="legend-row" title={m.hint}>
              <i style={{ background: m.hue }} />
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </nav>

      <main className="gallery-main" id="gallery-main" ref={main}>
        <header className="gallery-head">
          <div className="gallery-heading">
            <h1>Stencils</h1>
            <p data-testid="stencil-count" aria-live="polite">
              {filtered.length === stencils.length
                ? `${stencils.length} stencils from ${vendorCount} vendors`
                : `${filtered.length} of ${stencils.length} stencils`}
              {missingIcons > 0 && <span className="warn"> {missingIcons} missing an icon</span>}
            </p>
            <div className="gallery-search">
              <label className="field field-lg">
                <Icon name="search" />
                <input
                  ref={search}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && q) {
                      e.preventDefault();
                      setQ("");
                    }
                  }}
                  placeholder="Search names, vendors, roles, or try “sb”"
                  aria-label="Search stencils"
                  name="gallery-search"
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="gallery-search"
                />
                {q ? (
                  <button
                    type="button"
                    className="field-clear"
                    onClick={() => setQ("")}
                    aria-label="Clear search"
                    data-testid="gallery-search-clear"
                  >
                    <Icon name="close" size={12} />
                  </button>
                ) : (
                  <kbd>/</kbd>
                )}
              </label>
            </div>
          </div>

          <div className="gallery-filters">
            <div className="families" role="group" aria-label="Filter by family">
              <button
                className={`family${family === "all" && !vendor ? " is-on" : ""}`}
                aria-pressed={family === "all" && !vendor}
                onClick={() => pickFamily("all")}
                data-testid="family-chip-all"
              >
                All <span className="family-count">{searched.length}</span>
              </button>
              {families.map(({ family: f }) => {
                const n = searchedFamilies.get(f.id) ?? 0;
                const on = family === f.id && !vendor;
                return (
                  <button
                    key={f.id}
                    className={`family${on ? " is-on" : ""}${n ? "" : " is-empty"}`}
                    aria-pressed={on}
                    title={f.hint}
                    onClick={() => pickFamily(on ? "all" : f.id)}
                    style={{ "--family": f.hue } as CSSProperties}
                    data-testid={`family-chip-${f.id}`}
                  >
                    <i aria-hidden />
                    {f.label} <span className="family-count">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="gallery-filter-end">
              {vendor ? (
                <span className="token" data-testid="vendor-filter">
                  <i style={{ background: getFamily(familyOfVendor(vendor)).hue }} />
                  {vendor}
                  <button
                    onClick={() => pickFamily("all")}
                    aria-label={`Remove ${vendor} filter`}
                    data-testid="vendor-filter-clear"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ) : null}
              <button
                className={`btn btn-ghost${menu?.testId === "vendor-menu" ? " is-pressed" : ""}`}
                aria-haspopup="menu"
                aria-expanded={menu?.testId === "vendor-menu"}
                onClick={(e) => openVendorMenu(e.currentTarget)}
                data-testid="vendor-overflow"
              >
                Vendor <Icon name="chevron-down" size={13} />
              </button>
            </div>
          </div>
        </header>

        {sections.map(({ category, items }) => (
          <section
            key={category}
            id={`cat-${category}`}
            data-category={category}
            className="gallery-section"
            data-testid={`gallery-section-${category}`}
          >
            <div className="section-head">
              <h2>
                {categoryLabel[category] ?? category}
                <span>{items.length}</span>
              </h2>
              <p>{categoryBlurb[category]}</p>
            </div>
            <div className="tile-grid">
              {items.map((s) => (
                <StencilTile
                  key={s.id}
                  stencil={s}
                  open={detail === s.id}
                  onOpen={() => openDetail(s.id)}
                  onMenu={(x, y) => tileMenu(s, x, y)}
                  onAdd={() => addToCurrentDiagram(s.id)}
                  onCopyId={() => copy(s.id, "id")}
                  onDragState={(on) => setDragging(on ? s.id : null)}
                />
              ))}
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <div className="gallery-empty" data-testid="gallery-empty">
            <span className="gallery-empty-mark" aria-hidden>
              <Icon name="search" size={20} />
            </span>
            <strong>
              {q ? `Nothing matches “${q.trim()}”` : "No stencils here yet"}
              {scope ? ` in ${scope}` : ""}.
            </strong>
            <p>Search covers names, vendors, ids, roles and everyday shorthand like sb, pg, k8s or lambda.</p>
            <div className="gallery-empty-actions">
              {scope && q && (
                <button className="btn" onClick={() => pickFamily("all")} data-testid="empty-all-families">
                  Search all families
                </button>
              )}
              <button className="btn" onClick={clearAll} data-testid="empty-clear">
                Clear filters
              </button>
            </div>
          </div>
        )}

        <footer className="gallery-credits" data-testid="icon-credits">
          Icon credits: product logos and service icons are trademarks of their owners and are shown to identify those
          products. Microsoft Entra ID icon by{" "}
          <a href="https://selfh.st/icons" target="_blank" rel="noreferrer">
            selfh.st
          </a>
          ,{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
            CC BY 4.0
          </a>
          . Generic glyphs from{" "}
          <a href="https://lucide.dev" target="_blank" rel="noreferrer">
            Lucide
          </a>{" "}
          (ISC). Full sources and licences are in docs/ICONS.md.
        </footer>
      </main>

      {detailStencil && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            onClick={closeDetail}
            aria-label="Close stencil details"
            data-testid="drawer-scrim"
          />
          <StencilDrawer
            key="drawer"
            stencil={detailStencil}
            index={Math.max(0, detailIndex)}
            total={ordered.length}
            onStep={step}
            onClose={closeDetail}
            onAdd={() => addToCurrentDiagram(detailStencil.id)}
            onNewDiagram={() => openNewDiagramWith(detailStencil)}
            onCopy={copy}
            onCopyJson={() => copyJson(detailStencil)}
          />
        </>
      )}

      {dragging && (
        <div
          className={`gallery-dock${dropHover ? " is-over" : ""}`}
          data-testid="gallery-drop-target"
          onDragOver={(e: DragEvent) => {
            if (!e.dataTransfer.types.includes(STENCIL_DND_MIME)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setDropHover(true);
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(e: DragEvent) => {
            const id = e.dataTransfer.getData(STENCIL_DND_MIME);
            e.preventDefault();
            setDropHover(false);
            setDragging(null);
            if (id) addToCurrentDiagram(id);
          }}
        >
          <Icon name="plus" size={16} />
          Drop to add it to your diagram
        </div>
      )}

      {note && (
        <div className="gallery-note" role="status" data-testid="gallery-note">
          <Icon name="check" size={14} /> {note}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          label={menu.label}
          searchable={menu.searchable}
          testId={menu.testId}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

interface TileProps {
  stencil: Stencil;
  open: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onAdd: () => void;
  onCopyId: () => void;
  onDragState: (dragging: boolean) => void;
}

function StencilTile({ stencil: s, open, onOpen, onMenu, onAdd, onCopyId, onDragState }: TileProps) {
  const { nodeVariant } = useSettings();
  const { Component } = getNodeVariant(nodeVariant);
  const role = simRoleMeta[s.simRole] ?? simRoleMeta.none;
  const hasIcon = !!iconUrl(s.icon);

  return (
    <div
      className={`tile${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`${s.label}, ${s.vendor}. Open details`}
      aria-haspopup="dialog"
      draggable
      data-testid={`stencil-tile-${s.id}`}
      style={{ "--accent": s.accent } as CSSProperties}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(r.left + 16, r.top + 40);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(STENCIL_DND_MIME, s.id);
        // Dropping into an editor pastes a ready-made node.
        e.dataTransfer.setData("text/plain", JSON.stringify(nodeJson(s), null, 2));
        e.dataTransfer.effectAllowed = "copy";
        onDragState(true);
      }}
      onDragEnd={() => onDragState(false)}
    >
      <div className={`tile-stage stage-${nodeVariant}`} data-testid={`tile-stage-${s.id}`}>
        <Component stencil={s} label={s.label} sublabel={s.defaultSublabel} />
        {!hasIcon && (
          <span className="tile-missing" title={`No file at src/stencils/icons/${s.icon}.svg`}>
            missing {s.icon}.svg
          </span>
        )}
        {/* Pointer shortcuts only: the tile is a button, so it can't hold buttons. Keyboard and screen
            readers reach Add and Copy id through the tile's menu (Shift+F10) and the details drawer. */}
        <span
          className="tile-add"
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
          title="Add to current diagram"
          data-testid={`tile-add-${s.id}`}
        >
          <Icon name="plus" size={14} />
        </span>
      </div>
      <div className="tile-body">
        <div className="tile-row">
          <h3>{s.label}</h3>
          <span className="role" style={{ "--role": role.hue } as CSSProperties} title={role.hint}>
            {role.label}
          </span>
        </div>
        <div className="tile-vendor">
          <i className="tile-swatch" title={`Accent ${s.accent.toLowerCase()}`} />
          {s.vendor}
        </div>
        <p className="tile-desc">{s.description}</p>
        <div className="tile-foot">
          <span
            className="tile-id"
            aria-hidden="true"
            title="Copy stencil id"
            onClick={(e) => {
              e.stopPropagation();
              onCopyId();
            }}
            data-testid={`tile-copy-${s.id}`}
          >
            <span>{s.id}</span>
            <Icon name="copy" size={11} />
          </span>
        </div>
      </div>
    </div>
  );
}
