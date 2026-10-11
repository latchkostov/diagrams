import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { iconUrl, stencils } from "../stencils/registry";
import type { Stencil, StencilCategory } from "../model/types";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../harness/nodeVariants";
import { CATEGORY_ORDER, categoryBlurb, categoryLabel } from "../lib/categories";
import { simRoleMeta } from "../lib/simRoles";
import { Icon } from "../components/Icon";

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Review surface for the icon set: every stencil, as metadata and as a real diagram node. */
export function GalleryView() {
  const [q, setQ] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const vendors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of stencils) counts.set(s.vendor, (counts.get(s.vendor) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return stencils.filter(
      (s) =>
        (!vendor || s.vendor === vendor) &&
        (!needle || `${s.label} ${s.vendor} ${s.id} ${s.description} ${s.simRole}`.toLowerCase().includes(needle)),
    );
  }, [q, vendor]);

  const sections = useMemo(() => {
    const map = new Map<StencilCategory, Stencil[]>();
    for (const s of filtered) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    const order = [...CATEGORY_ORDER, ...[...map.keys()].filter((c) => !CATEGORY_ORDER.includes(c))];
    return order.filter((c) => map.has(c)).map((c) => ({ category: c, items: map.get(c)! }));
  }, [filtered]);

  const missingIcons = useMemo(() => stencils.filter((s) => !iconUrl(s.icon)).length, []);

  return (
    <div className="gallery" data-testid="gallery-view">
      <nav className="gallery-rail" aria-label="Categories">
        <div className="rail-title">Categories</div>
        {CATEGORY_ORDER.map((c) => {
          const n = sections.find((s) => s.category === c)?.items.length ?? 0;
          return (
            <button
              key={c}
              className="rail-link"
              disabled={!n}
              onClick={() => document.getElementById(`cat-${c}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
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

      <main className="gallery-main" id="gallery-main">
        <header className="gallery-head">
          <div className="gallery-heading">
            <h1>Stencils</h1>
            <p data-testid="stencil-count">
              {filtered.length === stencils.length
                ? `${stencils.length} stencils from ${vendors.length} vendors`
                : `${filtered.length} of ${stencils.length} stencils`}
              {missingIcons > 0 && <span className="warn"> {missingIcons} missing an icon</span>}
            </p>
          </div>
          <div className="gallery-tools">
            <div className="field field-lg">
              <Icon name="search" />
              <input
                ref={search}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, vendor, id or role"
                aria-label="Search stencils"
                name="gallery-search"
                data-testid="gallery-search"
              />
              <kbd>/</kbd>
            </div>
            <div className="chips" role="group" aria-label="Filter by vendor">
              <button className={`chip${vendor === null ? " is-on" : ""}`} onClick={() => setVendor(null)} data-testid="vendor-chip-all">
                All <span>{stencils.length}</span>
              </button>
              {vendors.map(([v, n]) => (
                <button
                  key={v}
                  className={`chip${vendor === v ? " is-on" : ""}`}
                  onClick={() => setVendor(vendor === v ? null : v)}
                  data-testid={`vendor-chip-${slugify(v)}`}
                >
                  {v} <span>{n}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {sections.map(({ category, items }) => (
          <section key={category} id={`cat-${category}`} className="gallery-section" data-testid={`gallery-section-${category}`}>
            <div className="section-head">
              <h2>
                {categoryLabel[category] ?? category}
                <span>{items.length}</span>
              </h2>
              <p>{categoryBlurb[category]}</p>
            </div>
            <div className="tile-grid">
              {items.map((s) => (
                <StencilTile key={s.id} stencil={s} />
              ))}
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <div className="gallery-empty">
            <strong>No stencils match “{q}”{vendor ? ` from ${vendor}` : ""}.</strong>
            <button
              className="btn"
              onClick={() => {
                setQ("");
                setVendor(null);
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        <footer className="gallery-credits" data-testid="icon-credits">
          Icon credits: product logos and service icons are trademarks of their owners and are shown to identify
          those products. Microsoft Entra ID icon by <a href="https://selfh.st/icons" target="_blank" rel="noreferrer">selfh.st</a>,{" "}
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Generic glyphs from{" "}
          <a href="https://lucide.dev" target="_blank" rel="noreferrer">Lucide</a> (ISC). Full sources and licences are in docs/ICONS.md.
        </footer>
      </main>
    </div>
  );
}

function StencilTile({ stencil: s }: { stencil: Stencil }) {
  const { nodeVariant } = useSettings();
  const { Component } = getNodeVariant(nodeVariant);
  const [copied, setCopied] = useState(false);
  const role = simRoleMeta[s.simRole] ?? simRoleMeta.none;
  const hasIcon = !!iconUrl(s.icon);

  return (
    <article className="tile" data-testid={`stencil-tile-${s.id}`} style={{ "--accent": s.accent } as CSSProperties}>
      <div className={`tile-stage stage-${nodeVariant}`}>
        <Component stencil={s} label={s.label} sublabel={s.defaultSublabel} />
        {!hasIcon && (
          <span className="tile-missing" title={`No file at src/stencils/icons/${s.icon}.svg`}>
            missing {s.icon}.svg
          </span>
        )}
      </div>
      <div className="tile-body">
        <div className="tile-row">
          <h3>{s.label}</h3>
          <span className="role" style={{ "--role": role.hue } as CSSProperties} title={role.hint}>
            {role.label}
          </span>
        </div>
        <div className="tile-vendor">{s.vendor}</div>
        <p className="tile-desc">{s.description}</p>
        <div className="tile-foot">
          <button
            className="tile-id"
            title="Copy stencil id"
            onClick={() => {
              navigator.clipboard?.writeText(s.id).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "copied" : s.id}
          </button>
          <span className="swatch" title="Accent colour">
            <i />
            {s.accent}
          </span>
        </div>
      </div>
    </article>
  );
}
