import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type View = "gallery" | "canvas" | "lab" | "tutorials";

/** View state mirrored in the query string so specific views can be linked. */
export interface UrlState {
  view: View;
  example?: string;
  present: boolean;
}

/**
 * The Lab (previews, fixtures, evals, a box that stores pasted diagrams) is a development tool: in dev builds and the
 * e2e build only. A production build has no Lab at all, and `?view=lab` opens the canvas.
 */
export const LAB = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
/** Tutorials (src/tutorials): a view of their own, in development and e2e builds until the owner has previewed them. */
export const TUTORIALS = import.meta.env.DEV || import.meta.env.VITE_E2E === "1";
const VIEWS: readonly View[] = [
  "gallery",
  "canvas",
  ...(LAB ? (["lab"] as const) : []),
  ...(TUTORIALS ? (["tutorials"] as const) : []),
];

// The diagram is the product: a bare URL opens the canvas (the stencil library is a tab).
const viewOf = (p: URLSearchParams): View => {
  const view = p.get("view") as View | null;
  return view && VIEWS.includes(view) ? view : "canvas";
};

function read(): UrlState {
  const p = new URLSearchParams(window.location.search);
  return {
    view: viewOf(p),
    example: p.get("example") ?? undefined,
    present: p.get("present") === "1",
  };
}

/** Query keys owned by the live view (src/live/urlParams.ts): they describe the diagram on screen. */
const LIVE_KEYS = ["live", "sim", "speed", "paused", "traffic"] as const;

const liveKeysOf = (p: URLSearchParams) => {
  const keys = new URLSearchParams();
  for (const k of LIVE_KEYS) {
    const v = p.get(k);
    if (v !== null) keys.set(k, v);
  }
  return keys;
};

/**
 * The diagram on the canvas and its live keys. A requested example opens only once it has downloaded,
 * so for a while the URL can name a pending diagram while another one is still on screen. The live keys
 * are kept here, with the diagram they belong to, and mirrored into the URL whenever it points at that
 * diagram: they never leak onto the pending one, and they come back when you switch back (or press Back).
 */
let shown: { identity: string; example: string; live: URLSearchParams } | null = null;

/**
 * Called by the app when the canvas shows a diagram (null when no canvas is mounted). A newly mounted
 * canvas starts from the live keys in the URL, which its live view has just read. `example` is the
 * URL value for it, which can change without a remount (a blank draft that became an entry).
 */
export function showDiagram(diagram: { identity: string; example: string } | null): void {
  if (!diagram) shown = null;
  else if (shown?.identity === diagram.identity) shown.example = diagram.example;
  else {
    const p = new URLSearchParams(window.location.search);
    shown = { ...diagram, live: viewOf(p) === "canvas" ? liveKeysOf(p) : new URLSearchParams() };
  }
}

/** The live keys of the diagram on screen, when the URL `p` shows it. */
const shownLiveKeys = (p: URLSearchParams) =>
  shown && viewOf(p) === "canvas" && p.get("example") === shown.example ? shown.live : null;

function setLiveKeys(p: URLSearchParams, keys: URLSearchParams) {
  for (const k of LIVE_KEYS) p.delete(k);
  for (const [k, v] of keys) p.set(k, v);
}

function replaceIfChanged(p: URLSearchParams) {
  const url = `${window.location.pathname}?${p}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`)
    window.history.replaceState(window.history.state, "", url);
}

/**
 * Updates the live keys of the diagram on screen, and the URL when it shows that diagram (never a
 * pending one). With no canvas mounted it edits a canvas URL's keys directly. Adds no history entry.
 */
export function updateLiveKeys(edit: (keys: URLSearchParams) => void): void {
  const p = new URLSearchParams(window.location.search);
  let keys: URLSearchParams | null = null;
  if (shown) {
    edit(shown.live);
    keys = shownLiveKeys(p);
  } else if (viewOf(p) === "canvas") {
    keys = liveKeysOf(p);
    edit(keys);
  }
  if (!keys) return;
  setLiveKeys(p, keys);
  replaceIfChanged(p);
}

/** A URL reached through history (Back, Forward) gets the current live keys of the diagram it shows. */
function syncLiveKeys() {
  const p = new URLSearchParams(window.location.search);
  const keys = shownLiveKeys(p);
  if (!keys) return;
  setLiveKeys(p, keys);
  replaceIfChanged(p);
}

function write(s: UrlState, push: boolean) {
  const current = new URLSearchParams(window.location.search);
  const p = new URLSearchParams();
  p.set("view", s.view);
  if (s.view === "canvas" && s.example) p.set("example", s.example);
  if (s.view === "canvas" && s.present) p.set("present", "1");
  // Live keys go with the diagram on screen (e.g. toggling presentation, or switching back to it
  // before a requested example has loaded). Simulation ids belong to a diagram, so another diagram
  // starts without them. A URL for a diagram that isn't on screen yet (still loading) keeps its own.
  const live =
    shownLiveKeys(p) ??
    (s.view === "canvas" && viewOf(current) === "canvas" && current.get("example") === (s.example ?? null)
      ? liveKeysOf(current)
      : null);
  if (live) setLiveKeys(p, live);
  // The Lab owns the rest of its query string (preset + control values); keep it when staying in the Lab.
  if (s.view === "lab" && current.get("view") === "lab") {
    for (const [k, v] of current) if (k !== "view") p.set(k, v);
  }
  const url = `${window.location.pathname}?${p}${window.location.hash}`;
  if (url === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function useUrlState(): [UrlState, (next: Partial<UrlState>, opts?: { replace?: boolean }) => void] {
  const [state, setState] = useState(read);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  useEffect(() => {
    const onPop = () => {
      syncLiveKeys();
      setState(read());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // History side effects stay out of the setState updater: StrictMode runs updaters twice,
  // which used to push every entry twice and break the Back button.
  const update = useCallback((next: Partial<UrlState>, opts?: { replace?: boolean }) => {
    const merged = { ...latest.current, ...next };
    latest.current = merged;
    write(merged, !opts?.replace);
    setState(merged);
  }, []);
  return [state, update];
}
