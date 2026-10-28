import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { lazyComponent, type LoadStatus } from "../lib/lazyLoad";
import { loadingDialog } from "../interop/ui/lazyDialogs";
import { t } from "../i18n";
import { matches, shortcutKeys } from "../editor/shortcuts";
import { captureModalTypeAhead, type TypeAhead } from "../canvas/typeAhead";
import type { PaletteDialogProps } from "./PaletteDialog";
import type { DiagramOption } from "./sources";

// The command palette's always-mounted shell: just the Ctrl/Cmd+K listener. The dialog (and the
// stencil catalogue it searches) loads on first use, so the app's first paint doesn't pay for it. It
// preloads as soon as the pointer moves (or Ctrl/Cmd goes down), so Ctrl+K opens at once; keys typed
// before its search can take them are held and handed over ("Ctrl+K kafka" searches "kafka").

type LoadingProps = PaletteDialogProps & { releaseTyping(): void };
const paletteLoading = loadingDialog<LoadingProps>(() => t("command.searchCommands"));
function PaletteLoading({ status, ...props }: LoadingProps & { status: LoadStatus }) {
  const { releaseTyping } = props;
  useEffect(() => {
    if (status.failed) releaseTyping();
  }, [status.failed, releaseTyping]);
  return paletteLoading(props, status);
}
const PaletteDialogLazy = lazyComponent<LoadingProps>(
  () => import("./PaletteDialog").then((m) => m.paletteDialogWhenReady()),
  (props, status) => <PaletteLoading {...props} status={status} />,
);

/** Ctrl/Cmd+K, from the shortcut table (so the cheat sheet lists it). */
const PALETTE_COMBO = shortcutKeys("command-palette");

export interface CommandPaletteProps {
  view: "canvas" | "gallery" | "lab" | "tutorials";
  /** "Your diagram" slots and public examples, as in the diagram picker. */
  diagrams: readonly DiagramOption[];
  currentSlug?: string;
  onOpenDiagram(slug: string): void;
  /** Present the open diagram (the top bar's Present); absent while presenting. */
  onPresent?(): void;
  /** The Tutorials view, where there is one. */
  onTutorials?(): void;
  tutorials?: readonly { id: string; title: string }[];
  onOpenTutorial?(id: string): void;
}

export function CommandPalette(props: CommandPaletteProps) {
  // The dialog to show (null: closed): the loaded one when its code is in, so it renders in the same
  // frame as the key press; otherwise its modal frame offers loading and recovery.
  const [open, setOpen] = useState<{ Dialog: ComponentType<LoadingProps> } | null>(null);
  const typing = useRef<{ stop: () => TypeAhead } | null>(null);
  const isOpen = open !== null;
  const releaseTyping = useCallback(() => {
    typing.current?.stop();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches(e, PALETTE_COMBO)) return;
      if (!isOpen && e.target instanceof Element && e.target.closest("[data-markdown-input]")) return;
      // Another modal dialog owns the keyboard until it closes.
      if (!isOpen && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (isOpen) return setOpen(null);
      typing.current?.stop();
      typing.current = captureModalTypeAhead(() => setOpen(null));
      setOpen({ Dialog: PaletteDialogLazy });
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

  useEffect(() => () => void typing.current?.stop(), []);

  // Warm the chunk on the first pointer move or Ctrl/Cmd press, else once the app is idle.
  useEffect(() => {
    const warm = () => {
      PaletteDialogLazy.preload();
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
      <Dialog
        {...props}
        releaseTyping={releaseTyping}
        onClose={() => setOpen(null)}
        typeAhead={() => {
          const t = typing.current?.stop() ?? { text: null };
          typing.current = null;
          return t;
        }}
      />
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
