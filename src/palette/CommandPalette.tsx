import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { matches, shortcutKeys } from "../editor/shortcuts";
import type { DiagramOption } from "./sources";

// The command palette's always-mounted shell: just the Ctrl/Cmd+K listener. The dialog (and the
// stencil catalogue it searches) loads on first use, so the app's first paint doesn't pay for it.

const PaletteDialog = lazy(() => import("./PaletteDialog").then((m) => ({ default: m.PaletteDialog })));

/** Ctrl/Cmd+K, from the shortcut table (so the cheat sheet lists it). */
const PALETTE_COMBO = shortcutKeys("command-palette");

export interface CommandPaletteProps {
  view: "canvas" | "gallery" | "lab";
  /** "Your diagram" slots and public examples, as in the diagram picker. */
  diagrams: readonly DiagramOption[];
  currentSlug?: string;
  onOpenDiagram(slug: string): void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !matches(e, PALETTE_COMBO)) return;
      // Another modal dialog owns the keyboard until it closes.
      if (!open && document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // Warm the chunk once the app is idle so the first Ctrl+K opens instantly.
  useEffect(() => {
    const t = setTimeout(() => void import("./PaletteDialog").catch(() => {}), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;
  return (
    <PaletteBoundary onError={() => setOpen(false)}>
      <Suspense fallback={null}>
        <PaletteDialog {...props} onClose={() => setOpen(false)} />
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
