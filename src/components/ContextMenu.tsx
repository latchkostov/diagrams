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
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { MenuItem, MenuNode } from "../editor/actions";
import { formatCombo } from "../editor/shortcuts";
import { getStencil } from "../stencils/registry";
import { scoreStencil } from "../lib/stencilDisplaySearch";
import { Icon } from "./Icon";
import { StencilIcon } from "./StencilIcon";
import { captureTypeAhead, type TypeAhead } from "../canvas/typeAhead";

// App context menu: keyboard navigable (arrows, Home/End, Enter, Esc, ←/→ for submenus),
// optional search-as-you-type, edge-aware placement. Submenus render as siblings in a fixed
// layer so nothing clips them. Closes on outside pointer-down, wheel, resize and window blur.

interface Anchor {
  /** Physical canvas coordinates are left-aligned regardless of page direction. */
  alignment?: "physical-left";
  x: number;
  y: number;
  /** Submenus: where to put the menu's right edge if it doesn't fit to the right. */
  flipX?: number;
  minWidth?: number;
}

/** Why a menu closed: an item ran, Esc, a press outside it, the wheel, the window's focus or size changing. */
export type ContextMenuCloseReason = "pick" | "escape" | "outside" | "scroll" | "blur" | "resize";

const MARGIN = 8;
const HOVER_DELAY = 110;
const MAX_RESULTS = 60;

export interface ContextMenuProps {
  alignment?: Anchor["alignment"];
  x: number;
  y: number;
  /** Where the menu's right edge goes when it doesn't fit right of `x` (it flips to the left). */
  flipX?: number;
  minWidth?: number;
  items: MenuNode[];
  onClose: (reason: ContextMenuCloseReason) => void;
  /** Root-level search box placeholder (quick-add, stencil picker). */
  searchable?: string;
  /** Accessible name. */
  label?: string;
  testId?: string;
  /** ID of the root menu, for its trigger's aria-controls. */
  menuId?: string;
  /** The trigger toggles its own menu instead of dismissing it on pointer-down. */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * Gives focus back to what had it when the menu opened, if the menu's closing left it on the page (default). The
   * canvas's menus say false: its focus controller gives it back (src/canvas/interaction, rows M1 and M2).
   */
  returnFocus?: boolean;
}

export function ContextMenu({
  x,
  y,
  flipX,
  alignment,
  minWidth,
  items,
  onClose,
  searchable,
  label = t("chrome.contextMenu"),
  testId = "context-menu",
  menuId,
  triggerRef,
  returnFocus = true,
}: ContextMenuProps) {
  useLocale();
  const layer = useRef<HTMLDivElement>(null);
  const invoker = useRef(returnFocus && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  // A searchable menu (quick-add) keeps what's typed before its search can take focus: it starts the search.
  const typing = useRef<{ stop: () => TypeAhead } | null>(null);
  useLayoutEffect(() => {
    if (!searchable) return;
    const t = captureTypeAhead();
    typing.current = t;
    return () => void t.stop();
  }, [searchable]);
  const takeTypeAhead = useCallback(() => {
    const t = typing.current?.stop();
    typing.current = null;
    return t;
  }, []);
  // The same anchor while the menu stays put: the list places itself whenever its anchor changes, so a new one on
  // every render moved a searchable menu that typing had shortened (from under the pointer: nightly #78).
  const anchor = useMemo(() => ({ x, y, flipX, alignment, minWidth }), [x, y, flipX, alignment, minWidth]);

  useEffect(() => {
    const previousFocus = invoker.current;
    const outside = (e: Event) => {
      if (e.type === "pointerdown" && triggerRef?.current?.contains(e.target as Node)) return;
      if (!layer.current?.contains(e.target as Node)) closeRef.current(e.type === "wheel" ? "scroll" : "outside");
    };
    const resized = () => closeRef.current("resize");
    const blurred = () => closeRef.current("blur");
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, { capture: true, passive: true });
    window.addEventListener("resize", resized);
    window.addEventListener("blur", blurred);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", resized);
      window.removeEventListener("blur", blurred);
      // Actions and outside clicks may deliberately focus another control. Let them win.
      if (previousFocus)
        queueMicrotask(() => {
          if (document.activeElement === document.body && previousFocus.isConnected)
            previousFocus.focus({ preventScroll: true });
        });
    };
  }, [triggerRef]);

  return createPortal(
    <div ref={layer} className="cm-layer" data-editor-overlay onContextMenu={(e) => e.preventDefault()}>
      <MenuList
        items={items}
        anchor={anchor}
        depth={0}
        searchable={searchable}
        takeTypeAhead={takeTypeAhead}
        focusOnMount
        activateFirst={false}
        onCloseAll={(reason) => closeRef.current(reason)}
        onBack={() => closeRef.current("escape")}
        label={label}
        testId={testId}
        menuId={menuId}
      />
    </div>,
    document.body,
  );
}

interface ListProps {
  items: MenuNode[];
  anchor: Anchor;
  depth: number;
  searchable?: string;
  /** Keys typed before the search had focus (the root of a searchable menu). */
  takeTypeAhead?: () => TypeAhead | undefined;
  focusOnMount: boolean;
  activateFirst: boolean;
  onCloseAll: (reason: "pick" | "escape") => void;
  onBack: () => void;
  label: string;
  testId: string;
  menuId?: string;
}

const selectable = (n: MenuNode | undefined): n is MenuItem => !!n && n.type === "item" && !n.disabled;

function leaves(items: MenuNode[], trail: string[] = []): { item: MenuItem; trail: string[] }[] {
  const out: { item: MenuItem; trail: string[] }[] = [];
  for (const n of items) {
    if (n.type !== "item") continue;
    if (n.children) out.push(...leaves(n.children, [...trail, n.label]));
    else out.push({ item: n, trail });
  }
  return out;
}

function search(items: MenuNode[], q: string): MenuNode[] {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  // A stencil listed twice (Recently used, and its category) is one result.
  const seen = new Set<string>();
  const hits: { item: MenuItem; i: number; score: number }[] = [];
  leaves(items).forEach(({ item, trail }, i) => {
    const hay = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${trail.join(" ")}`.toLowerCase();
    // Stencils rank as the rail's search ranks them, aliases included ("pg" → PostgreSQL, "go" → Go Service).
    const score = item.stencil ? scoreStencil(getStencil(item.stencil), q) : 0;
    if (score <= 0 && !tokens.every((t) => hay.includes(t))) return;
    if (item.stencil) {
      if (seen.has(item.stencil)) return;
      seen.add(item.stencil);
    }
    hits.push({ item, i, score });
  });
  return hits
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ item }) => item);
}

function MenuList(p: ListProps) {
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
  // The search takes what was typed before it could: Esc among it closes, Enter runs the best match.
  const take = p.takeTypeAhead;
  useLayoutEffect(() => {
    if (!placed || !take || !input.current) return;
    input.current.focus({ preventScroll: true });
    const t = take();
    if (!t) return;
    if (t.done === "escape") return p.onCloseAll("escape");
    if (t.done === "enter") {
      const best = (t.text ? search(p.items, t.text) : p.items).find(selectable);
      if (best && !best.children) {
        p.onCloseAll("pick");
        best.run?.();
        return;
      }
    }
    // Before any later key reaches the (now focused) field, and before the next paint.
    const text = t.text;
    if (text) queueMicrotask(() => setQ(text));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the menu is placed
  }, [placed, take]);

  // Search changes derive a fresh highlight before the next paint.
  const [previousShown, setPreviousShown] = useState(shown);
  if (previousShown !== shown) {
    setPreviousShown(shown);
    // Retranslation preserves the active row and open submenu when stable ids have not changed.
    if (
      previousShown.length !== shown.length ||
      previousShown.some(
        (n, i) => n.type !== shown[i].type || (n.type === "item" && (shown[i].type !== "item" || n.id !== shown[i].id)),
      )
    ) {
      setActive(shown.findIndex(selectable));
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
