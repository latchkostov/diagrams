import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import type { MenuItem, MenuNode } from "../editor/actions";
import { formatCombo } from "../editor/shortcuts";
import { getStencil } from "../stencils/registry";
import { Icon } from "./Icon";
import { StencilIcon } from "./StencilIcon";

// App context menu: keyboard navigable (arrows, Home/End, Enter, Esc, ←/→ for submenus),
// optional search-as-you-type, edge-aware placement. Submenus render as siblings in a fixed
// layer so nothing clips them. Closes on outside pointer-down, wheel, resize and window blur.

interface Anchor {
  x: number;
  y: number;
  /** Submenus: where to put the menu's right edge if it doesn't fit to the right. */
  flipX?: number;
}

const MARGIN = 8;
const HOVER_DELAY = 110;
const MAX_RESULTS = 60;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuNode[];
  onClose: () => void;
  /** Root-level search box placeholder (quick-add, stencil picker). */
  searchable?: string;
  /** Accessible name. */
  label?: string;
  testId?: string;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  searchable,
  label = "Context menu",
  testId = "context-menu",
}: ContextMenuProps) {
  const layer = useRef<HTMLDivElement>(null);
  const invoker = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = invoker.current;
    const outside = (e: Event) => {
      if (!layer.current?.contains(e.target as Node)) closeRef.current();
    };
    const close = () => closeRef.current();
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("wheel", outside, { capture: true, passive: true });
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("wheel", outside, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      // Actions and outside clicks may deliberately focus another control. Let them win.
      queueMicrotask(() => {
        if (document.activeElement === document.body && previousFocus?.isConnected)
          previousFocus.focus({ preventScroll: true });
      });
    };
  }, []);

  return createPortal(
    <div ref={layer} className="cm-layer" data-editor-overlay onContextMenu={(e) => e.preventDefault()}>
      <MenuList
        items={items}
        anchor={{ x, y }}
        depth={0}
        searchable={searchable}
        focusOnMount
        activateFirst={false}
        onCloseAll={() => closeRef.current()}
        onBack={() => closeRef.current()}
        label={label}
        testId={testId}
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
  focusOnMount: boolean;
  activateFirst: boolean;
  onCloseAll: () => void;
  onBack: () => void;
  label: string;
  testId: string;
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
  return leaves(items)
    .filter(({ item, trail }) => {
      const hay = `${item.label} ${item.hint ?? ""} ${item.keywords ?? ""} ${trail.join(" ")}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    })
    .slice(0, MAX_RESULTS)
    .map(({ item }) => item);
}

function MenuList(p: ListProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);
  const [q, setQ] = useState("");
  const shown = useMemo(() => (q.trim() ? search(p.items, q) : p.items), [p.items, q]);
  const [active, setActive] = useState(() => (p.activateFirst ? shown.findIndex(selectable) : -1));
  const [open, setOpen] = useState<{ index: number; anchor: Anchor; viaKeyboard: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Place once, against the full list, flipping / clamping at the viewport edges.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = p.anchor.x;
    if (left + r.width > vw - MARGIN) left = (p.anchor.flipX ?? p.anchor.x) - r.width;
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - r.width));
    let top = p.anchor.y;
    if (top + r.height > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - r.height);
    setPos({ left, top, maxHeight: vh - MARGIN - top });
  }, [p.anchor]);

  // Focus once placed (a visibility:hidden element can't take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (!p.focusOnMount || !placed) return;
    (input.current ?? ref.current)?.focus({ preventScroll: true });
  }, [p.focusOnMount, placed]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // Search changes derive a fresh highlight before the next paint.
  const [previousShown, setPreviousShown] = useState(shown);
  if (previousShown !== shown) {
    setPreviousShown(shown);
    setActive(shown.findIndex(selectable));
    setOpen(null);
  }

  useEffect(() => {
    if (active >= 0) itemRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const openSub = (index: number, viaKeyboard: boolean) => {
    const el = itemRefs.current[index];
    const item = shown[index];
    if (!el || !selectable(item) || !item.children) return;
    const r = el.getBoundingClientRect();
    setOpen({ index, anchor: { x: r.right - 4, y: r.top - 5, flipX: r.left + 4 }, viaKeyboard });
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
    p.onCloseAll();
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
    switch (e.key) {
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
        else p.onCloseAll();
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
    if (open?.index === index) return;
    const item = shown[index];
    hoverTimer.current = window.setTimeout(() => {
      if (selectable(item) && item.children) openSub(index, false);
      else if (open) closeSub();
    }, HOVER_DELAY);
  };

  const sub = open ? shown[open.index] : undefined;
  const activeItem = shown[active];
  const activeId = selectable(activeItem) ? `${id}-item-${activeItem.id}` : undefined;

  return (
    <>
      <div
        ref={ref}
        className={`cm${p.searchable ? " cm-searchable" : ""}`}
        role={p.searchable ? undefined : "menu"}
        aria-label={p.label}
        aria-activedescendant={!p.searchable ? activeId : undefined}
        tabIndex={-1}
        data-testid={p.testId}
        data-depth={p.depth}
        style={
          pos
            ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight }
            : { left: p.anchor.x, top: p.anchor.y, visibility: "hidden" }
        }
        onKeyDown={onKeyDown}
        onMouseLeave={() => {
          window.clearTimeout(hoverTimer.current);
          if (!open) setActive(-1);
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
              aria-controls={`${id}-items`}
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
          id={`${id}-items`}
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
            const isActive = i === active;
            const stencil = n.stencil ? getStencil(n.stencil) : undefined;
            return (
              <div
                key={n.id}
                id={`${id}-item-${n.id}`}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role={n.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
                aria-checked={n.checked}
                aria-disabled={n.disabled || undefined}
                aria-haspopup={n.children ? "menu" : undefined}
                aria-expanded={n.children ? open?.index === i : undefined}
                className={`cm-item${isActive ? " is-active" : ""}${n.disabled ? " is-disabled" : ""}${n.danger ? " is-danger" : ""}${open?.index === i ? " is-open" : ""}`}
                data-testid={`context-menu-item-${n.id}`}
                data-active={isActive || undefined}
                onMouseEnter={() => !n.disabled && hover(i)}
                onMouseDown={(e) => e.preventDefault()}
                onKeyDown={onKeyDown}
                onClick={() => activate(i, false)}
              >
                <span className="cm-lead">
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
          })}
          {shown.length === 0 && <div className="cm-empty">No matches</div>}
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
