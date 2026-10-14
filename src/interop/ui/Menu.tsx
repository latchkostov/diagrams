import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { formatCombo } from "../../editor/shortcuts";
import { Glyph } from "./glyphs";

// Top-bar dropdown (the File menu): rows with an icon, title, optional one-line description and
// shortcut, separators, and one level of submenus ("More formats ▸"). Keyboard: arrows / Home / End
// move, Enter or → opens a submenu, ← / Esc go back, Esc on the root returns focus to the trigger.

export type MenuEntry =
  | { type: "separator" }
  | { type: "section"; label: string }
  | { type: "note"; text: ReactNode }
  | {
      type: "item";
      testId: string;
      /** Omit for plain choice rows (e.g. the View menu's checked options). */
      icon?: ReactNode;
      title: string;
      desc?: ReactNode;
      /** Right-aligned muted text (e.g. ".drawio"). */
      hint?: string;
      shortcut?: string;
      disabled?: boolean;
      /** Radio-style choice: shows a check when true (the row is a menuitemradio). */
      checked?: boolean;
      /** With `checked`: an independent on/off setting (a menuitemcheckbox), not one of a set of choices. */
      checkbox?: boolean;
      onSelect?: () => void;
      /** Makes the row open a submenu (rendered with `data-testid={submenuTestId}`). */
      submenu?: () => MenuEntry[];
      submenuTestId?: string;
    };

interface Props {
  label: string;
  /** Renders the trigger; spread `props` onto the button. */
  trigger: (props: {
    onClick: (e: { detail: number }) => void;
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    ref: (el: HTMLButtonElement | null) => void;
  }) => ReactNode;
  entries: () => MenuEntry[];
  testId: string;
  onOpen?: () => void;
  width?: number;
}

const MARGIN = 8;
const HOVER_DELAY = 120;
/** A right-to-left language (src/i18n): menus open from the trigger's other edge, submenus to the left. */
const rtl = () => document.documentElement.dir === "rtl";

export function Menu({ label, trigger, entries, testId, onOpen, width = 300 }: Props) {
  const [open, setOpen] = useState(false);
  // Keyboard opens (Enter / Space: click with detail 0) focus the first item; mouse opens don't.
  const [viaKeyboard, setViaKeyboard] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // The trigger element, kept in state (a callback ref) so render never touches a ref.
  const [triggerEl, setTriggerEl] = useState<HTMLButtonElement | null>(null);

  const close = useCallback(
    (refocus = true) => {
      setOpen(false);
      setPos(null);
      if (refocus) triggerEl?.focus();
    },
    [triggerEl],
  );

  const toggle = (e: { detail: number }) => {
    if (open) return close();
    if (!triggerEl) return;
    onOpen?.();
    // Aligned with the trigger's end edge (its right; its left in a right-to-left language), kept on screen.
    const r = triggerEl.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, rtl() ? r.left : r.right - width), window.innerWidth - width - MARGIN);
    setPos({ top: r.bottom + 6, left });
    setViaKeyboard(e.detail === 0);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Element;
      if (!t.closest?.("[data-ix-menu]") && !triggerEl?.contains(t)) close(false);
    };
    const onResize = () => close(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close, triggerEl]);

  return (
    <>
      {trigger({
        onClick: toggle,
        "aria-expanded": open,
        "aria-haspopup": "menu",
        ref: setTriggerEl,
      })}
      {open && pos && (
        <MenuPanel
          focusFirst={viaKeyboard}
          label={label}
          entries={entries()}
          top={pos.top}
          left={pos.left}
          width={width}
          testId={testId}
          onCloseAll={close}
          onBack={() => close()}
        />
      )}
    </>
  );
}

interface PanelProps {
  label: string;
  entries: MenuEntry[];
  top: number;
  left: number;
  width: number;
  testId: string;
  onCloseAll: (refocus?: boolean) => void;
  onBack: () => void;
  /** Submenus: where the parent panel starts, to flip left when there's no room on the right. */
  parentLeft?: number;
  /** Focus the first item on open (keyboard); otherwise the panel itself takes focus. */
  focusFirst?: boolean;
}

function MenuPanel({
  label,
  entries,
  top,
  left,
  width,
  testId,
  onCloseAll,
  onBack,
  parentLeft,
  focusFirst = true,
}: PanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; top: number } | null>(null);
  const [place, setPlace] = useState({ top, left });
  const hoverTimer = useRef<number | undefined>(undefined);

  // Keep the panel on screen (submenus flip to the parent's left side when needed).
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const h = el.offsetHeight;
    let l = left;
    if (parentLeft !== undefined && l + width > window.innerWidth - MARGIN) l = parentLeft - width + 4;
    if (parentLeft !== undefined && l < MARGIN) l = parentLeft + width - 4;
    setPlace({ top: Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN)), left: Math.max(MARGIN, l) });
  }, [top, left, width, parentLeft]);

  useEffect(() => {
    if (focusFirst) panel.current?.querySelector<HTMLElement>("[data-menu-focus]")?.focus();
    else panel.current?.focus();
    return () => window.clearTimeout(hoverTimer.current);
  }, [focusFirst]);

  /** Opens the submenu of entry `index` (its panel focuses its first item). */
  const openSub = (index: number) => {
    const row = panel.current?.querySelector<HTMLElement>(`[data-submenu-index="${index}"]`);
    if (!row) return;
    setSub({ index, top: row.getBoundingClientRect().top - 6 });
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.target instanceof Node && !panel.current?.contains(e.target)) return;
    e.stopPropagation();
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("[data-menu-focus]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    const active = document.activeElement as HTMLElement | null;
    const subIndex = active?.dataset.submenuIndex;
    if (e.key === "Escape") {
      e.preventDefault();
      onBack();
    } else if (e.key === (rtl() ? "ArrowRight" : "ArrowLeft") && parentLeft !== undefined) {
      e.preventDefault();
      onBack();
    } else if (
      (e.key === (rtl() ? "ArrowLeft" : "ArrowRight") || e.key === "Enter" || e.key === " ") &&
      subIndex !== undefined
    ) {
      e.preventDefault();
      openSub(Number(subIndex));
    } else if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") onCloseAll(false);
  };

  const subEntry = sub ? entries[sub.index] : undefined;

  return createPortal(
    <>
      <div
        ref={panel}
        className="ix-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        style={{ top: place.top, left: place.left, width }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        data-testid={testId}
        data-ix-menu
        data-editor-overlay
      >
        {entries.map((entry, k) => {
          if (entry.type === "separator") return <div key={`s${k}`} className="ix-menu-sep" role="separator" />;
          if (entry.type === "section") {
            return (
              <div key={`h${k}`} className="ix-menu-section" role="presentation">
                {entry.label}
              </div>
            );
          }
          if (entry.type === "note") {
            return (
              <div key={`n${k}`} className="ix-menu-note" role="presentation">
                {entry.text}
              </div>
            );
          }
          const hasSub = !!entry.submenu;
          const isOpen = sub?.index === k;
          return (
            <div
              key={entry.testId}
              className={`ix-menu-row${entry.disabled ? " is-disabled" : ""}${isOpen ? " is-open" : ""}`}
            >
              <button
                className="ix-menu-item"
                role={entry.checked === undefined ? "menuitem" : entry.checkbox ? "menuitemcheckbox" : "menuitemradio"}
                aria-checked={entry.checked}
                aria-haspopup={hasSub ? "menu" : undefined}
                aria-expanded={hasSub ? isOpen : undefined}
                // Off, not gone: still a stop for the arrow keys, so a keyboard or screen reader hears why it's off
                // (a private diagram's link rows).
                aria-disabled={entry.disabled || undefined}
                onClick={() => {
                  if (entry.disabled) return;
                  if (hasSub) return isOpen ? setSub(null) : openSub(k);
                  onCloseAll(true);
                  entry.onSelect?.();
                }}
                onMouseEnter={() => {
                  window.clearTimeout(hoverTimer.current);
                  hoverTimer.current = window.setTimeout(() => (hasSub ? openSub(k) : setSub(null)), HOVER_DELAY);
                }}
                data-menu-focus
                data-submenu-index={hasSub ? k : undefined}
                data-testid={entry.testId}
              >
                {entry.icon && <span className="ix-menu-icon">{entry.icon}</span>}
                <span className="ix-menu-text">
                  <span className="ix-menu-title">{entry.title}</span>
                  {entry.desc && <span className="ix-menu-desc">{entry.desc}</span>}
                </span>
                {entry.hint && <span className="ix-menu-hint">{entry.hint}</span>}
                {entry.shortcut && <kbd className="ix-menu-kbd">{formatCombo(entry.shortcut)}</kbd>}
                {entry.checked && (
                  <span className="ix-menu-check">
                    <Glyph name="check" size={14} />
                  </span>
                )}
                {hasSub && (
                  <span className="ix-menu-chevron">
                    <Glyph name="chevron-right" size={13} />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
      {subEntry?.type === "item" && subEntry.submenu && sub && (
        <MenuPanel
          key={sub.index}
          label={subEntry.title}
          entries={subEntry.submenu()}
          top={sub.top}
          left={rtl() ? place.left - width + 4 : place.left + width - 4}
          parentLeft={place.left}
          width={width}
          testId={subEntry.submenuTestId ?? `${subEntry.testId}-menu`}
          onCloseAll={onCloseAll}
          onBack={() => {
            setSub(null);
            panel.current?.querySelector<HTMLElement>(`[data-submenu-index="${sub.index}"]`)?.focus();
          }}
        />
      )}
    </>,
    document.body,
  );
}
