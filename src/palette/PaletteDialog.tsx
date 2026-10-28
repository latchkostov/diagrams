import { surfaceCatalogs } from "../i18n/surfaces";
import "./routeActions";
import { tutorialMetadata } from "../tutorials/metadata";
import { t, useLocale } from "../i18n";
import { ROOMS } from "../lib/localOnly";
import { EDIT_TOGETHER } from "../lib/roomEntry";
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
import { openModalLayer } from "../lib/modalLayers";
import { isLocalOnly } from "../lib/localOnly";
import { collectCommands } from "./sources";
import { LANGUAGE_CHOICE } from "../lib/deployment";
import { openLanguageDialog } from "../i18n/start";
import type { TypeAhead } from "../canvas/typeAhead";

const PAGE = 8;
const PREFIX_HINTS: { prefix: keyof typeof PREFIXES; label: string }[] = [
  {
    prefix: ">",
    get label() {
      return t("command.actions");
    },
  },
  {
    prefix: "@",
    get label() {
      return t("view.nodes");
    },
  },
  {
    prefix: "+",
    get label() {
      return t("command.addStencil");
    },
  },
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
  onTutorials,
  tutorials,
  onOpenTutorial,
  onClose,
  typeAhead,
}: PaletteDialogProps) {
  const locale = useLocale();
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
  const [opened] = useState(() => ({
    view,
    diagrams,
    currentSlug,
    onOpenDiagram,
    onPresent,
    onTutorials,
    tutorials,
    onOpenTutorial,
  }));
  const commands = useMemo(
    () =>
      collectCommands({
        locale,
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
        openTutorials: opened.onTutorials,
        tutorials: opened.tutorials ?? tutorialMetadata.map((x) => ({ id: x.id, title: x.title() })),
        startTutorial: opened.onOpenTutorial,
        language: LANGUAGE_CHOICE ? openLanguageDialog : undefined,
        editTogether: ROOMS ? () => void window.dispatchEvent(new Event(EDIT_TOGETHER)) : undefined,
        sendStencilToCanvas: addToCurrentDiagram,
        onStencilUsed: pushRecentStencil,
        runSimulation: (simId) => {
          if (!paletteHost.runSimulation(simId))
            notify(t("chrome.liveViewIsnTAvailableForThisDiagram"), { kind: "error" });
        },
      }),
    // The session registers the live actions, so its arrival refreshes the list too.
    [host.canvas, host.live, host.session, opened, locale],
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

  // Match the pending Dialog lifecycle: its passive cleanup must restore inertness/focus
  // before this setup captures the opener and focuses the search.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const portal = el.parentElement;
    const background = Array.from(document.body.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c !== portal,
    );
    const wasInert = background.map((c) => c.inert);
    for (const c of background) c.inert = true;
    const closeLayer = openModalLayer(el, { opener: previousFocus });
    input.current?.focus({ preventScroll: true });
    return () => {
      background.forEach((c, i) => {
        c.inert = wasInert[i];
      });
      const focus = document.activeElement;
      if (previousFocus?.isConnected && (!focus || focus === document.body || el.contains(focus)))
        previousFocus.focus({ preventScroll: true });
      else if (!previousFocus?.isConnected && (!focus || focus === document.body || el.contains(focus)))
        document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
      closeLayer();
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
        notify(t("chrome.couldnTRunValue", { name: c.label }), { kind: "error" });
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
  const placeholder =
    view === "canvas" ? t("chrome.searchActionsNodesAndStencils") : t("chrome.searchDiagramsAndStencils");
  const count = flat.length;

  return createPortal(
    <div ref={backdrop} className="cmdk-backdrop" data-editor-overlay>
      <div
        ref={panel}
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label={t("command.commandPalette")}
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
            aria-label={t("command.searchCommands")}
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
          <kbd className="cmdk-esc">{formatCombo("Esc")}</kbd>
        </div>
        <div
          id={`${id}-list`}
          className="cmdk-list"
          role="listbox"
          aria-label={t("command.commands")}
          data-testid="command-list"
        >
          {ranked.map((g) => (
            <div
              key={g.group}
              role="group"
              aria-labelledby={`${id}-grp-${g.group}`}
              data-testid={`command-group-${g.group}`}
            >
              <div id={`${id}-grp-${g.group}`} className="cmdk-group" role="presentation">
                {GROUP_LABEL[g.group]()}
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
              {query.trim() ? t("chrome.noMatchesForValue", { query: query.trim() }) : t("chrome.nothingToShowHere")}
              {view === "canvas" && <span>{t("command.tryToAddAStencilOrToFindANode")}</span>}
            </div>
          )}
        </div>
        <footer className="cmdk-foot">
          <span className="cmdk-keys" aria-hidden>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            {t("command.move")}
            <kbd>↵</kbd>
            {t("command.run")}
            <kbd>{formatCombo("Esc")}</kbd>
            {t("command.close")}
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
                  title={
                    p.prefix === ">"
                      ? t("chrome.typeToSearchActionsOnly")
                      : p.prefix === "@"
                        ? t("chrome.typeToSearchNodesOnly")
                        : t("chrome.typeToSearchAddStencilOnly")
                  }
                >
                  <kbd>{p.prefix}</kbd> {p.label}
                </button>
              ))}
            </span>
          )}
        </footer>
        <div className="sr-only" role="status" aria-live="polite">
          {query.trim() ? t("chrome.valueResultOtherValueResults", { count }) : ""}
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
  useLocale();
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
          <span className="sr-only">{t("command.on")}</span>
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

// eslint-disable-next-line react-refresh/only-export-components -- optional strings share the component download lifecycle
export async function paletteDialogWhenReady() {
  await surfaceCatalogs(["tutorialTitles", "stencils"]);
  return PaletteDialog;
}
