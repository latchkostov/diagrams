/**
 * Which tutorial the address opens (`?tutorial=<id>`), if any. Kept tiny: it is the only tutorial code in the app's
 * startup chunk. Everything else loads with the tutorial surface (./lazyTutorial.tsx).
 *
 * A tutorial replaces the app's view while it runs (its own bar, canvas and sandbox diagram), so opening one adds a
 * history entry and leaving it goes back to exactly where you were, your diagram's address included.
 */
const KEY = "tutorial";
const OPENED = "livediagrams-tutorial";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export const tutorialRoute = {
  get: (): string | null => new URLSearchParams(window.location.search).get(KEY),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("popstate", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("popstate", listener);
    };
  },
  open(id: string, replace = false): void {
    const query = new URLSearchParams(window.location.search);
    query.set(KEY, id);
    window.history[replace ? "replaceState" : "pushState"](
      replace ? window.history.state : { [OPENED]: true },
      "",
      `${window.location.pathname}?${query}${window.location.hash}`,
    );
    emit();
  },
  /** Back where the tutorial was opened from; a tutorial reached by its link goes to the app instead. */
  close(): void {
    if ((window.history.state as Record<string, unknown> | null)?.[OPENED]) return window.history.back();
    window.history.replaceState(null, "", `${window.location.pathname}?view=canvas${window.location.hash}`);
    emit();
  },
};
