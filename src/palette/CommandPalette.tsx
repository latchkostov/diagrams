import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { matches, shortcutKeys } from "../editor/shortcuts";
import { captureTypeAhead, type TypeAhead } from "../canvas/typeAhead";
import type { PaletteDialogProps } from "./PaletteDialog";
import type { DiagramOption } from "./sources";

// The command palette's always-mounted shell: just the Ctrl/Cmd+K listener. The dialog (and the
// stencil catalogue it searches) loads on first use, so the app's first paint doesn't pay for it. It
// preloads as soon as the pointer moves (or Ctrl/Cmd goes down), so Ctrl+K opens at once; keys typed
// before its search can take them are held and handed over ("Ctrl+K kafka" searches "kafka").

let loaded: ComponentType<PaletteDialogProps> | null = null;
let loading: Promise<{ default: ComponentType<PaletteDialogProps> }> | null = null;

/** Loads the dialog's code once. */
function preloadPalette() {
  loading ??= import("./PaletteDialog").then((m) => {
    loaded = m.PaletteDialog;
    return { default: m.PaletteDialog };
  });
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

const PaletteDialogLazy = lazy(preloadPalette);

/** Ctrl/Cmd+K, from the shortcut table (so the cheat sheet lists it). */
const PALETTE_COMBO = shortcutKeys("command-palette");

export interface CommandPaletteProps {
  view: "canvas" | "gallery" | "lab";
  /** "Your diagram" slots and public examples, as in the diagram picker. */
  diagrams: readonly DiagramOption[];
  currentSlug?: string;
  onOpenDiagram(slug: string): void;
  /** Present the open diagram (the top bar's Present); absent while presenting. */
  onPresent?(): void;
}

export function CommandPalette(props: CommandPaletteProps) {
  // The dialog to show (null: closed): the loaded one when its code is in, so it renders in the same
  // frame as the key press; else the lazy one, which suspends until it arrives.
  const [open, setOpen] = useState<{ Dialog: ComponentType<PaletteDialogProps> } | null>(null);
  const typing = useRef<{ stop: () => TypeAhead } | null>(null);
  const isOpen = open !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches(e, PALETTE_COMBO)) return;
      // Another modal dialog owns the keyboard until it closes.
      if (!isOpen && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) return setOpen(null);
      typing.current?.stop();
      typing.current = captureTypeAhead();
      setOpen({ Dialog: loaded ?? PaletteDialogLazy });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen]);

  // Closed (or failed to load): nothing is held any more.
  useEffect(() => {
    if (isOpen) return;
    typing.current?.stop();
    typing.current = null;
  }, [isOpen]);

  // Warm the chunk on the first pointer move or Ctrl/Cmd press, else once the app is idle.
  useEffect(() => {
    const warm = () => {
      void preloadPalette().catch(() => {});
      stop();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Control" || e.key === "Meta") warm();
    };
    const t = setTimeout(warm, 3000);
    const stop = () => {
      clearTimeout(t);
      window.removeEventListener("pointermove", warm, true);
      window.removeEventListener("keydown", onKey, true);
    };
    window.addEventListener("pointermove", warm, true);
    window.addEventListener("keydown", onKey, true);
    return stop;
  }, []);

  if (!open) return null;
  const { Dialog } = open;
  return (
    <PaletteBoundary onError={() => setOpen(null)}>
      <Suspense fallback={null}>
        <Dialog
          {...props}
          onClose={() => setOpen(null)}
          typeAhead={() => {
            const t = typing.current?.stop() ?? { text: null };
            typing.current = null;
            return t;
          }}
        />
      </Suspense>
    </PaletteBoundary>
  );
}

/** A palette failure (or a chunk that won't load) closes the palette instead of blanking the app. */
class PaletteBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[palette]", error, info.componentStack);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
