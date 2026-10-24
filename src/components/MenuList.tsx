import { search, selectable } from "./menuSearch";
import { t, useLocale } from "../i18n";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { MenuItem, MenuNode } from "../editor/actions";
import { formatCombo } from "../editor/shortcuts";
import { getStencil } from "../stencils/registry";
import { Icon } from "./Icon";
import { StencilIcon } from "./StencilIcon";
import { type TypeAhead } from "../canvas/typeAhead";
import { flushSync } from "react-dom";

import type { Anchor } from "./ContextMenu";
const MARGIN = 8;
const HOVER_DELAY = 110;

export interface ListProps {
  items: MenuNode[];
  anchor: Anchor;
  depth: number;
  searchable?: string;
  /** Keys typed before the search had focus (the root of a searchable menu). */
  takeTypeAhead?: () => TypeAhead | undefined;
  takeNavigation?: () => globalThis.KeyboardEvent[];
  queueNavigation?: (event: globalThis.KeyboardEvent) => void;
  focusOnMount: boolean;
  activateFirst: boolean;
  onCloseAll: (reason: "pick" | "escape") => void;
  onBack: () => void;
  label: string;
  testId: string;
  menuId?: string;
}

export function MenuList(p: ListProps) {
  const locale = useLocale();
  const rtl = document.documentElement.dir === "rtl";
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [q, setQ] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stencil scoring reads the locale-dependent shared search index
  const shown = useMemo(() => (q.trim() ? search(p.items, q) : p.items), [p.items, q, locale]);
  const [active, setActive] = useState(() => (p.activateFirst ? shown.findIndex(selectable) : -1));
  const [open, setOpen] = useState<{ index: number; anchor: Anchor; viaKeyboard: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  /**
   * The row the pointer last moved onto (its item's id), apart from the highlight, which keys and the search move
   * too: moving onto a row hovers it, highlighted already or not; moving within it doesn't start its delay again.
   * Leaving the menu forgets it, so coming back hovers again.
   */
  const pointerOn = useRef<string | null>(null);
  /** The row whose hover delay is running (its item's id): a language change starts it again (below). */
  const hovering = useRef<string | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Place once, against the full list, flipping / clamping at the viewport edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const alignRight = rtl && p.anchor.alignment !== "physical-left";
    let left = alignRight ? p.anchor.x - r.width : p.anchor.x;
    if (alignRight && left < MARGIN) left = p.anchor.flipX ?? p.anchor.x;
    if (!alignRight && left + r.width > vw - MARGIN) left = (p.anchor.flipX ?? p.anchor.x) - r.width;
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - r.width));
    let top = p.anchor.y;
    if (top + r.height > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - r.height);
    setPos({ left, top, maxHeight: vh - MARGIN - top });
  }, [p.anchor, rtl, locale]);

  // Measure again after parent placement or direction changes, retaining the open row and its focus.
  const openIndex = open?.index;
  useLayoutEffect(() => {
    const row = openIndex === undefined ? null : itemRefs.current[openIndex];
    if (!row || !pos) return;
    const r = row.getBoundingClientRect();
    const anchor = { x: rtl ? r.left + 4 : r.right - 4, y: r.top - 5, flipX: rtl ? r.right - 4 : r.left + 4 };
    setOpen((current) =>
      current &&
      (current.anchor.x !== anchor.x || current.anchor.y !== anchor.y || current.anchor.flipX !== anchor.flipX)
        ? { ...current, anchor }
        : current,
    );
  }, [openIndex, pos, rtl, locale]);

  // Focus once placed (a visibility:hidden element can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (!p.focusOnMount || !placed) return;
    (input.current ?? ref.current)?.focus({ preventScroll: true });
  }, [p.focusOnMount, placed]);
  const takeNavigation = p.takeNavigation;
  useLayoutEffect(() => {
    if (!placed || !takeNavigation || p.searchable) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !ref.current) return;
      ref.current.focus({ preventScroll: true });
      for (const event of takeNavigation()) {
        if (!ref.current) break;
        flushSync(() => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", event)));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [placed, takeNavigation, p.searchable]);
  // The search takes what was typed before it could: Esc among it closes, Enter runs the best match.
  const take = p.takeTypeAhead;
  useLayoutEffect(() => {
    if (!placed || !take || !input.current) return;
    let cancelled = false;
    // Leave capture in charge until the buffered query and highlight have committed. Focusing an
    // empty search first lets the next Enter run before the queued state update has selected a row.
    queueMicrotask(() => {
      if (cancelled || !input.current) return;
      const t = take();
      if (t?.done === "escape") return p.onCloseAll("escape");
      if (t?.done === "enter") {
        const best = (t.text ? search(p.items, t.text) : p.items).find(selectable);
        if (best && !best.children) {
          p.onCloseAll("pick");
          best.run?.();
          return;
        }
      }
      const text = t?.text;
      if (text) flushSync(() => setQ(text));
      input.current?.focus({ preventScroll: true });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the menu is placed
  }, [placed, take]);

  // Search changes derive a fresh highlight before the next paint.
  const [previousShown, setPreviousShown] = useState(shown);
  if (previousShown !== shown) {
    setPreviousShown(shown);
    // Deferred choices keep the highlighted type even when their numeric values move.
    const previous = previousShown[active];
    const retained =
      !q.trim() && selectable(previous) && previous.identity !== undefined
        ? shown.findIndex((n) => selectable(n) && n.identity === previous.identity)
        : -1;
    // Retranslation preserves the active row and open submenu when stable ids have not changed.
    if (
      previousShown.length !== shown.length ||
      previousShown.some(
        (n, i) =>
          n.type !== shown[i].type ||
          (n.type === "item" && (shown[i].type !== "item" || n.id !== shown[i].id || n.identity !== shown[i].identity)),
      )
    ) {
      setActive(retained >= 0 ? retained : shown.findIndex(selectable));
      setOpen(null);
    }
  }

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openSub = (index: number, viaKeyboard: boolean) => {
    const el = itemRefs.current[index];
    const item = shown[index];
    if (!el || !selectable(item) || !item.children) return;
    const r = el.getBoundingClientRect();
    setOpen({
      index,
      anchor: { x: rtl ? r.left + 4 : r.right - 4, y: r.top - 5, flipX: rtl ? r.right - 4 : r.left + 4 },
      viaKeyboard,
    });
  };

  const closeSub = () => {
    setOpen(null);
    (input.current ?? ref.current)?.focus({ preventScroll: true });
  };

  const activate = (index: number, viaKeyboard: boolean) => {
    const item = shown[index];
    if (!selectable(item)) return;
    if (item.children) {
      openSub(index, viaKeyboard);
      return;
    }
    p.onCloseAll("pick");
    item.run?.();
  };

  const move = (dir: 1 | -1) => {
    const n = shown.length;
    if (!n) return;
    let i = active;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      if (selectable(shown[i])) {
        setActive(i);
        return;
      }
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    const inInput = e.target === input.current;
    const key = rtl ? (e.key === "ArrowLeft" ? "ArrowRight" : e.key === "ArrowRight" ? "ArrowLeft" : e.key) : e.key;
    switch (key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        if (inInput) return;
        e.preventDefault();
        setActive(shown.findIndex(selectable));
        break;
      case "End":
        if (inInput) return;
        e.preventDefault();
        for (let i = shown.length - 1; i >= 0; i--) if (selectable(shown[i])) return setActive(i);
        break;
      case "ArrowRight":
        if (inInput && q) return;
        e.preventDefault();
        if (active >= 0) openSub(active, true);
        break;
      case "ArrowLeft":
        if (inInput && q) return;
        e.preventDefault();
        if (p.depth > 0) p.onBack();
        break;
      case "Enter":
        e.preventDefault();
        if (active >= 0) activate(active, true);
        break;
      case " ":
        if (inInput) return;
        e.preventDefault();
        if (active >= 0) activate(active, true);
        break;
      case "Escape":
        e.preventDefault();
        if (inInput && q) setQ("");
        else if (p.depth > 0) p.onBack();
        else p.onCloseAll("escape");
        break;
      case "Tab":
        e.preventDefault();
        move(e.shiftKey ? -1 : 1);
        break;
    }
  };

  const hover = (index: number) => {
    setActive(index);
    window.clearTimeout(hoverTimer.current);
    hovering.current = null;
    if (open?.index === index) return;
    const item = shown[index];
    hovering.current = selectable(item) ? item.id : null;
    hoverTimer.current = window.setTimeout(() => {
      hovering.current = null;
      if (selectable(item) && item.children) openSub(index, false);
      else if (open) closeSub();
    }, HOVER_DELAY);
  };

  // Rows are memoized: moving the highlight re-renders the two rows that changed, not the menu.
  // Their callbacks are stable and reach the latest handlers through a ref.
  /** The pointer moved on row `index`: hover it if it moved there from elsewhere. */
  const pointerMove = (index: number) => {
    const item = shown[index];
    if (!selectable(item) || pointerOn.current === item.id) return;
    pointerOn.current = item.id;
    hover(index);
  };

  const handlers = useRef({ pointerMove, activate, onKeyDown });
  useLayoutEffect(() => {
    handlers.current = { pointerMove, activate, onKeyDown };
  });

  // A pending hover captures the old direction and rows: after a locale change it would read the moved row and
  // overwrite the refreshed submenu anchor. So it's cancelled, and started again with this render's rows: the pointer
  // at rest on its row never moves onto it again, so nothing else would (the row would stay closed until it left).
  useLayoutEffect(() => {
    const id = hovering.current;
    if (id) {
      const i = shown.findIndex((n) => n.type === "item" && n.id === id);
      if (i >= 0) hover(i);
      else hovering.current = pointerOn.current = null;
    }
    return () => window.clearTimeout(hoverTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per language, with that render's rows and handlers
  }, [locale]);
  const rowEnter = useCallback((i: number) => handlers.current.pointerMove(i), []);
  const rowClick = useCallback((i: number) => handlers.current.activate(i, false), []);
  const rowKeyDown = useCallback((e: ReactKeyboardEvent) => handlers.current.onKeyDown(e), []);
  const rowRef = useCallback((i: number, el: HTMLDivElement | null) => {
    itemRefs.current[i] = el;
  }, []);

  const sub = open ? shown[open.index] : undefined;
  const activeItem = shown[active];
  const activeId = selectable(activeItem) ? `${id}-item-${activeItem.id}` : undefined;
  const preview = selectable(activeItem) ? activeItem.onPreview : undefined;
  useLayoutEffect(() => {
    preview?.();
  }, [preview]);

  return (
    <>
      <div
        ref={ref}
        id={!p.searchable ? p.menuId : undefined}
        className={`cm${p.searchable ? " cm-searchable" : ""}`}
        role={p.searchable ? undefined : "menu"}
        aria-label={p.label}
        aria-activedescendant={!p.searchable ? activeId : undefined}
        tabIndex={-1}
        data-testid={p.testId}
        data-depth={p.depth}
        style={
          pos
            ? {
                left: pos.left,
                top: pos.top,
                maxHeight: pos.maxHeight,
                ...(p.anchor.minWidth ? { minWidth: p.anchor.minWidth } : {}),
              }
            : {
                left: p.anchor.x,
                top: p.anchor.y,
                visibility: "hidden",
                ...(p.anchor.minWidth ? { minWidth: p.anchor.minWidth } : {}),
              }
        }
        onKeyDown={onKeyDown}
        onMouseLeave={() => {
          window.clearTimeout(hoverTimer.current);
          hovering.current = null;
          pointerOn.current = null;
          // A search keeps its highlight: it is what Enter picks, and the pointer wandering off mustn't undo the
          // typing (it did, and Enter in quick-add's search did nothing).
          if (!open && !p.searchable) setActive(-1);
        }}
      >
        {p.searchable && (
          <div className="cm-search">
            <Icon name="search" size={14} />
            <input
              ref={input}
              role="searchbox"
              aria-autocomplete="list"
              aria-haspopup="menu"
              aria-controls={p.menuId ?? `${id}-items`}
              aria-activedescendant={activeId}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={p.searchable}
              aria-label={p.searchable}
              name="menu-search"
              autoComplete="off"
              spellCheck={false}
              data-testid={`${p.testId}-search`}
            />
          </div>
        )}
        <div
          id={p.searchable ? (p.menuId ?? `${id}-items`) : `${id}-items`}
          className="cm-items"
          role={p.searchable ? "menu" : undefined}
          aria-label={p.searchable ? p.label : undefined}
        >
          {shown.map((n, i) => {
            if (n.type === "separator") return <div key={`sep-${i}`} className="cm-sep" role="separator" />;
            if (n.type === "header")
              return (
                <div key={`hdr-${i}`} className="cm-header" role="presentation">
                  {n.label}
                </div>
              );
            return (
              <MenuRow
                key={n.id}
                item={n}
                index={i}
                domId={`${id}-item-${n.id}`}
                active={i === active}
                open={open?.index === i}
                onEnter={rowEnter}
                onClick={rowClick}
                onKeyDown={rowKeyDown}
                setRef={rowRef}
              />
            );
          })}
          {shown.length === 0 && <div className="cm-empty">{t("menu.noMatches")}</div>}
        </div>
      </div>
      {open && selectable(sub) && sub.children && (
        <MenuList
          key={`${sub.id}`}
          items={sub.children}
          anchor={open.anchor}
          depth={p.depth + 1}
          searchable={sub.searchable}
          focusOnMount={open.viaKeyboard || !!sub.searchable}
          activateFirst={open.viaKeyboard}
          onCloseAll={p.onCloseAll}
          onBack={closeSub}
          label={sub.label}
          testId={`${p.testId}-sub`}
        />
      )}
    </>
  );
}

interface RowProps {
  item: MenuItem;
  index: number;
  domId: string;
  active: boolean;
  open: boolean;
  onEnter: (index: number) => void;
  onClick: (index: number) => void;
  onKeyDown: (e: ReactKeyboardEvent) => void;
  setRef: (index: number, el: HTMLDivElement | null) => void;
}

const MenuRow = memo(function MenuRow({
  item: n,
  index,
  domId,
  active,
  open,
  onEnter,
  onClick,
  onKeyDown,
  setRef,
}: RowProps) {
  const ref = useCallback((el: HTMLDivElement | null) => setRef(index, el), [setRef, index]);
  const stencil = n.stencil ? getStencil(n.stencil) : undefined;
  return (
    <div
      id={domId}
      ref={ref}
      role={n.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
      aria-checked={n.checked}
      aria-disabled={n.disabled || undefined}
      aria-haspopup={n.children ? "menu" : undefined}
      aria-expanded={n.children ? open : undefined}
      title={n.title}
      className={`cm-item${n.className ? ` ${n.className}` : ""}${active ? " is-active" : ""}${n.disabled ? " is-disabled" : ""}${n.danger ? " is-danger" : ""}${open ? " is-open" : ""}`}
      data-testid={`context-menu-item-${n.id}`}
      data-active={active || undefined}
      // The pointer moving on a row hovers it; a row arriving under a pointer at rest doesn't (mouseenter would:
      // typing in quick-add's search slid another stencil under the pointer, and Enter added that one instead).
      onMouseMove={() => !n.disabled && onEnter(index)}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
      onClick={() => onClick(index)}
    >
      <span className="cm-lead" data-testid={`context-menu-icon-${n.id}`}>
        {stencil ? (
          <span className="cm-tile" style={{ "--accent": stencil.accent } as CSSProperties}>
            <StencilIcon stencil={stencil} size={14} />
          </span>
        ) : n.swatch ? (
          <span className="cm-swatch" style={{ background: n.swatch }} />
        ) : n.icon ? (
          <Icon name={n.icon} size={15} />
        ) : null}
      </span>
      <span className="cm-label">{n.label}</span>
      {n.hint && <span className="cm-hint">{n.hint}</span>}
      {n.shortcut && <span className="cm-kbd">{formatCombo(n.shortcut)}</span>}
      {n.checked && (
        <span className="cm-check">
          <Icon name="check" size={14} />
        </span>
      )}
      {n.children && (
        <span className="cm-chevron">
          <Icon name="chevron-right" size={13} />
        </span>
      )}
    </div>
  );
});
