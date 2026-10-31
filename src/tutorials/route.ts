/**
 * Which tutorial the address opens (`?tutorial=<id>`), if any. Kept tiny: it is the only tutorial code in the app's
 * startup chunk. Everything else loads with the tutorial surface (./lazyTutorial.tsx).
 *
 * A tutorial replaces the app's view while it runs (its own bar, canvas and sandbox diagram), so opening one adds a
 * history entry and leaving it goes back to exactly where you were, your diagram's address included.
 */
import type { View } from "../lib/urlState";

const KEY = "tutorial";
const OPENED = "livediagrams-tutorial";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let returnView: View | undefined;
const onPop = () => {
  if (returnView) {
    const query = new URLSearchParams(window.location.search);
    query.set("view", returnView);
    returnView = undefined;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
  }
  emit();
};

export const tutorialRoute = {
  get: (): string | null => new URLSearchParams(window.location.search).get(KEY),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("popstate", onPop);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) window.removeEventListener("popstate", onPop);
    };
  },
  open(id: string, replace = false): void {
    const query = new URLSearchParams(window.location.search);
    if (query.get(KEY) == id) return;
    query.set(KEY, id);
    window.history[replace ? "replaceState" : "pushState"](
      replace ? window.history.state : { [OPENED]: true },
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
    emit();
  },
  /** Leave for a document without dropping in-memory file handles or draft identity. */
  openDiagram(slug: string): void {
    tutorialRoute.openView("canvas", slug);
  },
  /** App views use the same in-document navigation as a saved copy or example. */
  openView(view: View, slug?: string): void {
    const query = new URLSearchParams({ view });
    if (view === "canvas" && slug) query.set("example", slug);
    window.history.pushState(null, "", `${window.location.pathname}?${query}`);
    emit();
  },
  /** Pop the lesson entry when present; an explicit destination replaces the restored view, keeping Back intact. */
  close(view?: View): void {
    if ((window.history.state as Record<string, unknown> | null)?.[OPENED]) {
      returnView = view;
      return window.history.back();
    }
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?view=${view ?? "canvas"}${window.location.hash}`,
    );
    emit();
  },
};
