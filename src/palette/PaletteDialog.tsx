import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import "../styles/palette.css";
import { actionRegistry } from "../editor/actions";
import { formatCombo, isEditableTarget } from "../editor/shortcuts";
import { getStencil, stencils } from "../stencils/registry";
import { addToCurrentDiagram } from "../lib/canvasBridge";
import { getRecentStencils, pushRecentStencil } from "../lib/recentStencils";
import { Icon } from "../components/Icon";
import { StencilIcon } from "../components/StencilIcon";
import { notify } from "../interop/ui/toast";
import type { CommandPaletteProps } from "./CommandPalette";
import { paletteHost } from "./host";
import { flatten, GROUP_LABEL, PREFIXES, rank, type Command, type CommandGroup } from "./rank";
import { getRecentCommands, pushRecentCommand, rememberable } from "./recent";
import { isLocalOnly } from "../lib/localOnly";
import { collectCommands } from "./sources";
import type { TypeAhead } from "../canvas/typeAhead";

const PAGE = 8;
const PREFIX_HINTS: { prefix: keyof typeof PREFIXES; label: string }[] = [
  { prefix: ">", label: "Actions" },
  { prefix: "@", label: "Nodes" },
  { prefix: "+", label: "Add stencil" },
];

export interface PaletteDialogProps extends CommandPaletteProps {
  onClose(): void;
  /** What was typed between Ctrl+K and the search taking focus (it starts the search). */
  typeAhead?: () => TypeAhead;
}

/** Ctrl/Cmd+K: every action, node, stencil, simulation and diagram, one search away. */
export function PaletteDialog({
  view,
  diagrams,
  currentSlug,
  onOpenDiagram,
  onPresent,
  onClose,
  typeAhead,
}: PaletteDialogProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // The context (selection, open diagram) is read when the palette opens; it follows the canvas
  // and live view as they publish themselves (Ctrl+K pressed while the canvas is still loading).
  const host = useSyncExternalStore(paletteHost.subscribe, paletteHost.get);
  const [opened] = useState(() => ({ view, diagrams, currentSlug, onOpenDiagram, onPresent }));
  const commands = useMemo(
    () =>
      collectCommands({
        registry: actionRegistry,
        canvas: host.canvas,
        live: host.live,
        session: host.session,
        view: opened.view,
        stencils,
        recentStencils: getRecentStencils(),
        diagrams: opened.diagrams,
        currentSlug: opened.currentSlug,
        openDiagram: opened.onOpenDiagram,
        present: opened.onPresent,
        sendStencilToCanvas: addToCurrentDiagram,
        onStencilUsed: pushRecentStencil,
        runSimulation: (simId) => {
          if (!paletteHost.runSimulation(simId))
            notify("Live view isn't available for this diagram.", { kind: "error" });
        },
      }),
    // The session registers the live actions, so its arrival refreshes the list too.
    [host.canvas, host.live, host.session, opened],
  );
  const [recent] = useState(getRecentCommands);
  const [query, setQuery] = useState("");
  const [submenu, setSubmenu] = useState<string | null>(null);
  const ranked = useMemo(
    () => rank(submenu ? commands.filter((c) => c.parent === submenu) : commands, query, recent),
    [commands, query, recent, submenu],
  );
  const flat = useMemo(() => flatten(ranked), [ranked]);
  const [active, setActive] = useState(0);
  // A new query highlights its best match before the next paint.
  const [previous, setPrevious] = useState(ranked);
  if (previous !== ranked) {
    setPrevious(ranked);
    setActive(0);
  }
  const activeItem = flat[active];
  const optionId = (c: Command) => `${id}-opt-${c.id}`;

  useEffect(() => {
    if (activeItem) itemRefs.current.get(activeItem.id)?.scrollIntoView({ block: "nearest" });
  }, [activeItem]);

  // Modal: the rest of the page is inert while open; focus goes back where it was on close.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const portal = el.parentElement;
    const background = Array.from(document.body.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== portal,
    );
    const wasInert = background.map((c) => c.inert);
    for (const c of background) c.inert = true;
    input.current?.focus({ preventScroll: true });
    return () => {
      background.forEach((c, i) => {
        c.inert = wasInert[i];
      });
      const focus = document.activeElement;
      if (previousFocus?.isConnected && (!focus || focus === document.body || el.contains(focus)))
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const run = (c: Command | undefined) => {
    if (!c || c.disabled) return;
    if (c.drill) {
      setSubmenu(c.id);
      setQuery(`>${c.drill} `);
      input.current?.focus();
      return;
    }
    if (rememberable(c, isLocalOnly(paletteHost.get().canvas))) pushRecentCommand(c.id);
    closeRef.current();
    // After the palette has closed and handed focus back, so commands that move focus (rename) win.
    window.setTimeout(() => {
      try {
        c.run?.();
      } catch (err) {
        console.error("[palette]", err);
        notify(`Couldn't run “${c.label}”.`, { kind: "error" });
      }
    }, 0);
  };

  const move = (delta: number, wrap = true) => {
    const n = flat.length;
    if (!n) return;
    setActive((i) => (wrap ? (i + delta + n) % n : Math.max(0, Math.min(n - 1, i + delta))));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // The palette owns the keyboard while open (canvas shortcuts, live keys, presentation Esc).
    e.stopPropagation();
    // A focused prefix button handles its own Enter / Space.
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "PageDown":
        e.preventDefault();
        move(PAGE, false);
        break;
      case "PageUp":
        e.preventDefault();
        move(-PAGE, false);
        break;
      case "Enter":
        e.preventDefault();
        if (!e.isComposing) run(activeItem);
        break;
      case "Escape":
        e.preventDefault();
        if (submenu) {
          setSubmenu(null);
          setQuery(">");
        } else closeRef.current();
        break;
      case "Tab": {
        // Focus trap: cycle between the input and the prefix buttons.
        e.preventDefault();
        const stops = Array.from(panel.current?.querySelectorAll<HTMLElement>("input, button") ?? []);
        const i = stops.indexOf(document.activeElement as HTMLElement);
        stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
        break;
      }
    }
  };

  // Native listeners (as in the other dialogs): the panel owns the keyboard, the scrim closes.
  const keyRef = useRef(onKeyDown);
  useLayoutEffect(() => {
    keyRef.current = onKeyDown;
  });
  useEffect(() => {
    const el = panel.current;
    const scrim = backdrop.current;
    if (!el || !scrim) return;
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    const onDown = (e: MouseEvent) => {
      if (e.target === scrim) closeRef.current();
    };
    const onMenu = (e: MouseEvent) => {
      if (!isEditableTarget(e.target)) e.preventDefault();
    };
    el.addEventListener("keydown", onKey);
    scrim.addEventListener("mousedown", onDown);
    scrim.addEventListener("contextmenu", onMenu);
    return () => {
      el.removeEventListener("keydown", onKey);
      scrim.removeEventListener("mousedown", onDown);
      scrim.removeEventListener("contextmenu", onMenu);
    };
  }, []);

  const setPrefix = (prefix: string) => {
    setSubmenu(null);
    setQuery((q) => `${prefix}${q.replace(/^\s*[>@+]\s*/, "")}`);
    input.current?.focus();
  };

  // Rows are memoized: moving the highlight re-renders the two rows that changed, not the list.
  // Their callbacks are stable and reach the latest state through a ref.
  const latest = useRef({ flat, active, run });
  useLayoutEffect(() => {
    latest.current = { flat, active, run };
  });
  // Keys typed before the search had focus start it; an Enter among them runs the best match, an Esc closes.
  const typed = useRef(typeAhead);
  const tookTyped = useRef(false);
  useLayoutEffect(() => {
    if (tookTyped.current) return;
    tookTyped.current = true;
    const t = typed.current?.();
    if (!t) return;
    if (t.done === "escape") return closeRef.current();
    if (t.done === "enter") return run(flatten(rank(commands, t.text ?? "", recent))[0]);
    if (t.text) setQuery(t.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the search takes focus
  }, []);
  const rowHover = useCallback((c: Command) => {
    const i = latest.current.flat.indexOf(c);
    if (i !== latest.current.active) setActive(i);
  }, []);
  const rowRun = useCallback((c: Command) => latest.current.run(c), []);
  const rowRef = useCallback((c: Command, el: HTMLDivElement | null) => {
    if (el) itemRefs.current.set(c.id, el);
    else itemRefs.current.delete(c.id);
  }, []);

  // The > @ + prefixes are taught once, by the footer's clickable chips.
  const placeholder = view === "canvas" ? "Search actions, nodes and stencils…" : "Search diagrams and stencils…";
  const count = flat.length;

  return createPortal(
    <div ref={backdrop} className="cmdk-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
      >
        <div className="cmdk-search">
          <Icon name="search" size={16} />
          <input
            ref={input}
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-autocomplete="list"
            aria-label="Search commands"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setSubmenu(null);
              setQuery(e.target.value);
            }}
            name="command-search"
            autoComplete="off"
            spellCheck={false}
            data-testid="command-input"
          />
          <kbd className="cmdk-esc">Esc</kbd>
        </div>
        <div id={`${id}-list`} className="cmdk-list" role="listbox" aria-label="Commands" data-testid="command-list">
          {ranked.map((g) => (
            <div
              key={g.group}
              role="group"
              aria-labelledby={`${id}-grp-${g.group}`}
              data-testid={`command-group-${g.group}`}
            >
              <div id={`${id}-grp-${g.group}`} className="cmdk-group" role="presentation">
                {GROUP_LABEL[g.group]}
              </div>
              {g.items.map((c) => (
                <Row
                  key={c.id}
                  command={c}
                  id={optionId(c)}
                  active={c === activeItem}
                  group={g.group}
                  setRef={rowRef}
                  onHover={rowHover}
                  onRun={rowRun}
                />
              ))}
            </div>
          ))}
          {count === 0 && (
            <div className="cmdk-empty" data-testid="command-empty">
              {query.trim() ? `No matches for “${query.trim()}”.` : "Nothing to show here."}
              {view === "canvas" && <span> Try + to add a stencil or @ to find a node.</span>}
            </div>
          )}
        </div>
        <footer className="cmdk-foot">
          <span className="cmdk-keys" aria-hidden>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move <kbd>↵</kbd> run <kbd>Esc</kbd> close
          </span>
          {view === "canvas" && (
            <span className="cmdk-prefixes">
              {PREFIX_HINTS.map((p) => (
                <button
                  key={p.prefix}
                  type="button"
                  className="cmdk-prefix"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setPrefix(p.prefix)}
                  data-testid={`command-prefix-${PREFIXES[p.prefix]}`}
                  title={`Type ${p.prefix} to search ${p.label.toLowerCase()} only`}
                >
                  <kbd>{p.prefix}</kbd> {p.label}
                </button>
              ))}
            </span>
          )}
        </footer>
        <div className="sr-only" role="status" aria-live="polite">
          {query.trim() ? `${count} ${count === 1 ? "result" : "results"}` : ""}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface RowProps {
  command: Command;
  id: string;
  active: boolean;
  group: CommandGroup;
  setRef: (command: Command, el: HTMLDivElement | null) => void;
  onHover: (command: Command) => void;
  onRun: (command: Command) => void;
}

const Row = memo(function Row({ command: c, id, active, group, setRef, onHover, onRun }: RowProps) {
  const stencil = c.stencil ? getStencil(c.stencil) : undefined;
  const ref = useCallback((el: HTMLDivElement | null) => setRef(c, el), [setRef, c]);
  return (
    <div
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={c.disabled || undefined}
      tabIndex={-1}
      className={`cmdk-item${active ? " is-active" : ""}${c.danger ? " is-danger" : ""}${c.disabled ? " is-disabled" : ""}`}
      data-testid={`command-item-${c.id}`}
      data-group={group}
      data-active={active || undefined}
      onMouseMove={() => onHover(c)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onRun(c)}
      onKeyDown={() => {}}
    >
      <span className="cmdk-lead">
        {stencil ? (
          <span className="cmdk-tile" style={{ "--accent": stencil.accent } as CSSProperties}>
            <StencilIcon stencil={stencil} size={15} />
          </span>
        ) : c.swatch ? (
          <span className="cmdk-swatch" style={{ background: c.swatch }} />
        ) : (
          <Icon name={c.icon ?? "chevron-right"} size={15} />
        )}
      </span>
      <span className="cmdk-label">{c.label}</span>
      {c.hint && <span className="cmdk-hint">{c.hint}</span>}
      {c.checked && (
        <span className="cmdk-check">
          <Icon name="check" size={14} />
          <span className="sr-only">(on)</span>
        </span>
      )}
      {c.shortcut && <kbd className="cmdk-kbd">{formatCombo(c.shortcut)}</kbd>}
      {c.drill && (
        <span className="cmdk-chevron" aria-hidden>
          <Icon name="chevron-right" size={13} />
        </span>
      )}
    </div>
  );
});
