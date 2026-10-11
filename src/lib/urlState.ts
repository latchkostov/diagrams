import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type View = "gallery" | "canvas" | "lab";

/** View state mirrored in the query string so specific views can be linked. */
export interface UrlState {
  view: View;
  example?: string;
  present: boolean;
}

const VIEWS: readonly View[] = ["gallery", "canvas", "lab"];

function read(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const view = p.get("view") as View | null;
  return {
    // The diagram is the product: a bare URL opens the canvas (the stencil library is a tab).
    view: view && VIEWS.includes(view) ? view : "canvas",
    example: p.get("example") ?? undefined,
    present: p.get("present") === "1",
  };
}

/** Query keys owned by the live view, preserved across URL rewrites on the same diagram. */
const LIVE_KEYS = ["live", "sim", "speed", "paused", "traffic"] as const;

function write(s: UrlState, push: boolean) {
  const current = new URLSearchParams(window.location.search);
  const p = new URLSearchParams();
  p.set("view", s.view);
  if (s.view === "canvas" && s.example) p.set("example", s.example);
  if (s.view === "canvas" && s.present) p.set("present", "1");
  // The live view owns these (src/live/urlParams.ts); keep them while the same diagram stays open
  // (e.g. toggling presentation). Simulation ids belong to a diagram, so switching drops them.
  if (s.view === "canvas" && current.get("view") === "canvas" && current.get("example") === (s.example ?? null)) {
    for (const k of LIVE_KEYS) {
      const v = current.get(k);
      if (v !== null) p.set(k, v);
    }
  }
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
    const onPop = () => setState(read());
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
