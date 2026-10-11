import { useCallback, useEffect, useState } from "react";

/** View state mirrored in the query string so specific views can be linked. */
export interface UrlState {
  view: "gallery" | "canvas";
  example?: string;
  present: boolean;
}

function read(): UrlState {
  const p = new URLSearchParams(window.location.search);
  return {
    view: p.get("view") === "canvas" ? "canvas" : "gallery",
    example: p.get("example") ?? undefined,
    present: p.get("present") === "1",
  };
}

function write(s: UrlState, push: boolean) {
  const p = new URLSearchParams();
  p.set("view", s.view);
  if (s.view === "canvas" && s.example) p.set("example", s.example);
  if (s.view === "canvas" && s.present) p.set("present", "1");
  const url = `${window.location.pathname}?${p}${window.location.hash}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function useUrlState(): [UrlState, (next: Partial<UrlState>, opts?: { replace?: boolean }) => void] {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const update = useCallback((next: Partial<UrlState>, opts?: { replace?: boolean }) => {
    setState((s) => {
      const merged = { ...s, ...next };
      write(merged, !opts?.replace);
      return merged;
    });
  }, []);
  return [state, update];
}
