import { useCallback, useEffect, useRef, useState } from "react";

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
    view: view && VIEWS.includes(view) ? view : "gallery",
    example: p.get("example") ?? undefined,
    present: p.get("present") === "1",
  };
}

function write(s: UrlState, push: boolean) {
  const current = new URLSearchParams(window.location.search);
  const p = new URLSearchParams();
  p.set("view", s.view);
  if (s.view === "canvas" && s.example) p.set("example", s.example);
  if (s.view === "canvas" && s.present) p.set("present", "1");
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
  latest.current = state;
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
