import { surfaceCatalogs } from "../i18n/surfaces";
import { stencilLabel, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { stencilDescription } from "../i18n/stencilDescriptions";
import { tRich } from "../i18n/rich";
import { formatNumber } from "../i18n/number";

import { categoryLabel, familyLabel } from "../i18n/chrome";
import { categoryBlurb, familyHint } from "../i18n/galleryChrome";
import { t, useLocale } from "../i18n";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import { stencils } from "../stencils/registry";
import { iconUrl } from "../stencils/iconUrls";
import type { Stencil, StencilCategory } from "../model/types";
import { useSettings } from "../harness/settings";
import { getNodeVariant } from "../canvas/nodes/variantRegistry";
import { CATEGORY_ORDER, clientSections } from "../lib/categories";
import { galleryRoleMeta as simRoleMeta } from "../i18n/galleryRoles";
import {
  familyCounts,
  familyOf,
  familyOfVendor,
  getFamily,
  vendorsByFamily,
  type FamilyId,
} from "../lib/vendorFamilies";
import { searchStencils } from "../lib/stencilDisplaySearch";
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
  const locale = useLocale();
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- shared search metadata resolves the current locale
  const searched = useMemo(() => searchStencils(stencils, q), [q, locale]);
  const searchedFamilies = useMemo(() => {
    const m = new Map<FamilyId, number>();
    for (const s of searched) m.set(familyOf(s), (m.get(familyOf(s)) ?? 0) + 1);
    return m;
  }, [searched]);

  // A narrow window folds the last families into the Vendor menu instead of scrolling them behind
  // a fade. The picked family always keeps its chip. Folded chips stay in the track, invisible, so
  // they can still be measured.
  const filters = useRef<HTMLDivElement>(null);
  const [folded, setFolded] = useState<FamilyId[]>([]);
  useLayoutEffect(() => {
    const row = filters.current;
    const track = row?.querySelector<HTMLElement>(".families");
    const end = row?.querySelector<HTMLElement>(".gallery-filter-end");
    if (!row || !track || !end) return;
    const fit = () => {
      const chip = (id: string) =>
        track.querySelector<HTMLElement>(`[data-testid="family-chip-${id}"]`)?.offsetWidth ?? 0;
      const css = getComputedStyle(row);
      const gap = parseFloat(css.columnGap) || 0;
      // The row's room, less the Vendor end, the track's padding and its 2px gaps.
      let room = row.clientWidth - end.offsetWidth - gap - 6 - chip("all");
      const picked = family !== "all" && !vendor ? family : null;
      if (picked) room -= chip(picked) + 2;
      const next: FamilyId[] = [];
      for (const { family: f } of families) {
        if (f.id === picked) continue;
        const w = chip(f.id) + 2;
        if (!next.length && w <= room) room -= w;
        else next.push(f.id);
      }
      // Transfer keyboard position before the chip becomes invisible.
      if (next.some((id) => track.querySelector(`[data-testid="family-chip-${id}"]`) === document.activeElement))
        end.querySelector<HTMLElement>('[data-testid="vendor-overflow"]')?.focus({ preventScroll: true });
      setFolded((cur) => (cur.join() === next.join() ? cur : next));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [families, family, vendor, searchedFamilies, locale]);

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
    return cats
      .filter((c) => map.has(c))
      .map((c) => ({
        category: c,
        items: c === "clients" ? clientSections(map.get(c)!).flatMap((s) => s.items) : map.get(c)!,
      }));
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
    const done = () => setNote(t("chrome.copiedValue", { what }));
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(done, () => setNote(t("chrome.couldnTReachTheClipboard")));
    else setNote(t("chrome.couldnTReachTheClipboard"));
  }, []);
  const copyJson = useCallback(
    (s: Stencil) => copy(JSON.stringify(nodeJson(s), null, 2), t("chrome.jSONNode")),
    [copy],
  );

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
      label: t("chrome.valueMenu", { name: stencilLabel(s) }),
      testId: "tile-menu",
      items: [
        {
          type: "item",
          id: "tile-add",
          get label() {
            return t("gallery.addToCurrentDiagram");
          },
          icon: "plus",
          run: () => addToCurrentDiagram(s.id),
        },
        {
          type: "item",
          id: "tile-details",
          get label() {
            return t("gallery.viewDetails");
          },
          icon: "info",
          run: () => openDetail(s.id),
        },
        { type: "separator" },
        {
          type: "item",
          id: "tile-copy-id",
          get label() {
            return t("gallery.copyId");
          },
          icon: "copy",
          hint: s.id,
          run: () => copy(s.id, t("chrome.id")),
        },
        {
          type: "item",
          id: "tile-copy-json",
          get label() {
            return t("gallery.copyAsJSONNode");
          },
          icon: "copy",
          run: () => copyJson(s),
        },
      ],
    });

  // Tiles are memoized: opening one re-renders the two whose "open" changed, not all 155. Their
  // actions are one stable object reaching the latest handlers through a ref.
  const latest = useRef({ openDetail, tileMenu });
  useLayoutEffect(() => {
    latest.current = { openDetail, tileMenu };
  });
  const tileActions = useMemo<TileActions>(
    () => ({
      open: (s) => latest.current.openDetail(s.id),
      menu: (s, x, y) => latest.current.tileMenu(s, x, y),
      add: (s) => addToCurrentDiagram(s.id),
      copyId: (s) => copy(s.id, t("chrome.id")),
      drag: (s, on) => setDragging(on ? s.id : null),
    }),
    [copy],
  );

  const openVendorMenu = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    // Families at the top level, vendors one level down: short enough to open below the button,
    // and the search box still finds any vendor directly.
    const items: MenuNode[] = [
      // Families that don't fit the track (a narrow window) are picked here instead.
      ...(folded.length
        ? [
            {
              type: "header",
              get label() {
                return t("gallery.moreFamilies");
              },
            } as const,
          ]
        : []),
      ...folded.map((id): MenuNode => {
        const f = getFamily(id);
        return {
          type: "item",
          id: `family:${id}`,
          label: familyLabel[f.id],
          swatch: f.hue,
          hint: formatNumber(searchedFamilies.get(id) ?? 0, { useGrouping: false }),
          checked: family === id && !vendor,
          run: () => pickFamily(id),
        };
      }),
      ...(folded.length ? [{ type: "separator" } as const] : []),
      {
        type: "item",
        id: "vendor:all",
        get label() {
          return t("gallery.allVendors");
        },
        checked: vendor === null,
        hint: formatNumber(stencils.length, { useGrouping: false }),
        run: () => pickFamily("all"),
      },
      { type: "separator" },
    ];
    for (const g of vendorsByFamily(stencils)) {
      items.push({
        type: "item",
        id: `vendor-family:${g.family.id}`,
        label: familyLabel[g.family.id],
        swatch: g.family.hue,
        hint: t("chrome.valueVendorOtherValueVendors", { count: g.vendors.length }),
        checked: !!vendor && familyOfVendor(vendor) === g.family.id,
        children: g.vendors.map((v) => ({
          type: "item" as const,
          id: `vendor:${slugify(v.vendor)}`,
          label: vendorLabel(v.vendor),
          hint: formatNumber(v.count, { useGrouping: false }),
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
      get label() {
        return t("gallery.filterByVendor");
      },
      testId: "vendor-menu",
      get searchable() {
        return t("gallery.findAVendor");
      },
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

  const scope = vendor ? vendorLabel(vendor) : family === "all" ? null : familyLabel[family];

  return (
    <div
      className="gallery"
      data-testid="gallery-view"
      onContextMenu={(e) => {
        // The app owns right-click; the search box keeps the native menu (paste, spellcheck).
        if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      <nav data-testid="gallery-rail" className="gallery-rail" aria-label={t("gallery.categories")}>
        <div className="rail-title">{t("gallery.categories")}</div>
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
              <span className="rail-count">{formatNumber(n, { useGrouping: false })}</span>
            </button>
          );
        })}
        <div className="rail-legend">
          <div className="rail-title">{t("gallery.simulationRoles")}</div>
          {Object.entries(simRoleMeta).map(([role, m]) => (
            <div key={role} className="legend-row" title={m.hint}>
              <i style={{ background: m.hue }} />
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </nav>

      <main className="gallery-main" id="gallery-main" ref={main}>
        <header className="gallery-head" data-testid="gallery-head">
          <div className="gallery-heading">
            <h1>{t("topbar.stencils")}</h1>
            <p data-testid="stencil-count" aria-live="polite">
              {filtered.length === stencils.length
                ? t("chrome.valueStencilsOtherValueStencilsFromValueVendorsOtherValue", {
                    count: stencils.length,
                    vendors: vendorCount,
                  })
                : t("chrome.valueOtherValueOfValueStencilsOtherValueStencils", {
                    count: filtered.length,
                    total: stencils.length,
                  })}
              {missingIcons > 0 && <span className="warn">{t("gallery.missingIcons", { count: missingIcons })}</span>}
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
                  placeholder={t("gallery.searchNamesVendorsRolesOrTrySb")}
                  aria-label={t("importReport.searchStencils")}
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
                    aria-label={t("library.clearSearch")}
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

          <div className="gallery-filters" ref={filters}>
            <div className="families" role="group" aria-label={t("gallery.filterByFamily")}>
              <button
                className={`family${family === "all" && !vendor ? " is-on" : ""}`}
                aria-pressed={family === "all" && !vendor}
                onClick={() => pickFamily("all")}
                data-testid="family-chip-all"
              >
                {t("gallery.all")}
                <span className="family-count">{formatNumber(searched.length, { useGrouping: false })}</span>
              </button>
              {families.map(({ family: f }) => {
                const n = searchedFamilies.get(f.id) ?? 0;
                const on = family === f.id && !vendor;
                const isFolded = folded.includes(f.id);
                return (
                  <button
                    key={f.id}
                    className={`family${on ? " is-on" : ""}${n ? "" : " is-empty"}${isFolded ? " is-folded" : ""}`}
                    aria-pressed={on}
                    data-folded={isFolded ? "1" : undefined}
                    title={familyHint[f.id]}
                    onClick={() => pickFamily(on ? "all" : f.id)}
                    style={{ "--family": f.hue } as CSSProperties}
                    data-testid={`family-chip-${f.id}`}
                  >
                    <i aria-hidden />
                    {familyLabel[f.id]} <span className="family-count">{formatNumber(n, { useGrouping: false })}</span>
                  </button>
                );
              })}
            </div>
            <div className="gallery-filter-end">
              {vendor ? (
                <span className="token" data-testid="vendor-filter">
                  <i style={{ background: getFamily(familyOfVendor(vendor)).hue }} />
                  {vendorLabel(vendor)}
                  <button
                    onClick={() => pickFamily("all")}
                    aria-label={t("chrome.removeValueFilter", { vendor: vendorLabel(vendor) })}
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
                {t("gallery.vendor")}
                <Icon name="chevron-down" size={13} />
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
                <span>{formatNumber(items.length, { useGrouping: false })}</span>
              </h2>
              <p>{categoryBlurb[category]}</p>
            </div>
            {category === "clients" ? (
              clientSections(items).map((section) => (
                <section key={section.id} className="gallery-subsection" data-testid={`gallery-clients-${section.id}`}>
                  <h3>{section.id === "sources" ? t("chrome.clientsWebhooks") : t("chrome.externalSystems")}</h3>
                  <div className="tile-grid">
                    {section.items.map((s) => (
                      <StencilTile key={s.id} stencil={s} open={detail === s.id} actions={tileActions} />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="tile-grid">
                {items.map((s) => (
                  <StencilTile key={s.id} stencil={s} open={detail === s.id} actions={tileActions} />
                ))}
              </div>
            )}
          </section>
        ))}

        {sections.length === 0 && (
          <div className="gallery-empty" data-testid="gallery-empty">
            <span className="gallery-empty-mark" aria-hidden>
              <Icon name="search" size={20} />
            </span>
            <strong>
              {q
                ? scope
                  ? t("chrome.nothingMatchesValueInValueText", { query: q.trim(), scope })
                  : t("chrome.nothingMatchesValue", { query: q.trim() })
                : scope
                  ? t("chrome.noStencilsHereYetInValue", { scope })
                  : t("chrome.noStencilsHereYet")}
            </strong>
            <p>{t("gallery.searchCoversNamesVendorsIdsRolesAndEverydayShorthandLike")}</p>
            <div className="gallery-empty-actions">
              {scope && q && (
                <button className="btn" onClick={() => pickFamily("all")} data-testid="empty-all-families">
                  {t("library.searchAllFamilies")}
                </button>
              )}
              <button className="btn" onClick={clearAll} data-testid="empty-clear">
                {t("gallery.clearFilters")}
              </button>
            </div>
          </div>
        )}

        <footer className="gallery-credits" data-testid="icon-credits">
          {tRich("gallery.iconCreditsProductLogosAndServiceIconsAreTrademarksOfText", {
            source: (chunks) => (
              <a href="https://selfh.st/icons" target="_blank" rel="noreferrer">
                {chunks}
              </a>
            ),
            licence: (chunks) => (
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
                {chunks}
              </a>
            ),
            glyphs: (chunks) => (
              <a href="https://lucide.dev" target="_blank" rel="noreferrer">
                {chunks}
              </a>
            ),
          })}
        </footer>
      </main>

      {detailStencil && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            onClick={closeDetail}
            aria-label={t("gallery.closeStencilDetails")}
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
          {t("gallery.dropToAddItToYourDiagram")}
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

interface TileActions {
  open: (s: Stencil) => void;
  menu: (s: Stencil, x: number, y: number) => void;
  add: (s: Stencil) => void;
  copyId: (s: Stencil) => void;
  drag: (s: Stencil, dragging: boolean) => void;
}

interface TileProps {
  stencil: Stencil;
  open: boolean;
  actions: TileActions;
}

const StencilTile = memo(function StencilTile({ stencil: s, open, actions }: TileProps) {
  useLocale();
  const onOpen = () => actions.open(s);
  const onMenu = (x: number, y: number) => actions.menu(s, x, y);
  const onAdd = () => actions.add(s);
  const onCopyId = () => actions.copyId(s);
  const onDragState = (on: boolean) => actions.drag(s, on);
  const { nodeVariant } = useSettings();
  const { Component } = getNodeVariant(nodeVariant);
  const role = simRoleMeta[s.simRole] ?? simRoleMeta.none;
  const hasIcon = !!iconUrl(s.icon);

  return (
    <div
      className={`tile${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={t("chrome.valueValueOpenDetails", { name: stencilLabel(s), vendor: vendorLabel(s.vendor) })}
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
        <Component stencil={s} stencilName={stencilLabel(s)} label={stencilLabel(s)} sublabel={stencilSubtitle(s)} />
        {!hasIcon && (
          <span
            className="tile-missing"
            title={t("chrome.noFileAtValue", { path: `src/stencils/icons/${s.icon}.svg` })}
          >
            {t("chrome.missingValue", { file: `${s.icon}.svg` })}
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
          title={t("gallery.addToCurrentDiagram")}
          data-testid={`tile-add-${s.id}`}
        >
          <Icon name="plus" size={14} />
        </span>
      </div>
      <div className="tile-body">
        <div className="tile-row">
          <h3>{stencilLabel(s)}</h3>
          <span className="role" style={{ "--role": role.hue } as CSSProperties} title={role.hint}>
            {role.label}
          </span>
        </div>
        <div className="tile-vendor">
          <i className="tile-swatch" title={t("chrome.accentValue", { colour: s.accent.toLowerCase() })} />
          {vendorLabel(s.vendor)}
        </div>
        <p className="tile-desc">{stencilDescription(s)}</p>
        <div className="tile-foot">
          <span
            className="tile-id"
            aria-hidden="true"
            title={t("gallery.copyStencilId")}
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
});

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function galleryWhenReady() {
  await surfaceCatalogs(["stencils"]);
  return { default: GalleryView };
}
