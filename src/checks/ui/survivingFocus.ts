import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** Focus `el`, made focusable from code only when it isn't already. */
function focusTarget(el: HTMLElement) {
  if (el.tabIndex < 0 && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/**
 * A fix can remove several findings at once, when the next check arrives: the row that had focus (or the neighbour
 * focus moved on to) may go with it. After each render, if focus was in a list of findings and fell to the page
 * with its element, it goes to a finding that survived, else to the list's fallback (the card's Close), else to the
 * persistent scope itself (the inspector's body). `scopeOf` names the persistent scope a focused element belongs
 * to, or null for one this hook doesn't own.
 */
export function useSurvivingCheckFocus(scopeOf: (el: HTMLElement) => HTMLElement | null) {
  const owner = useRef(scopeOf);
  useLayoutEffect(() => {
    owner.current = scopeOf;
  });
  const focused = useRef<{ el: HTMLElement; scope: HTMLElement } | null>(null);
  useEffect(() => {
    const remember = (e: FocusEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const scope = el?.closest("[data-check-scope]") ? owner.current(el) : null;
      focused.current = el && scope ? { el, scope } : null;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  useLayoutEffect(() => {
    const was = focused.current;
    const active = document.activeElement;
    if (!was || was.el.isConnected || (active && active !== document.body)) return;
    focused.current = null;
    if (!was.scope.isConnected) return;
    const target =
      was.scope.querySelector<HTMLElement>("[data-check-scope] [data-check-head]") ??
      was.scope.querySelector<HTMLElement>("[data-check-fallback]") ??
      (was.scope.hasAttribute("data-check-fallback-scope") ? was.scope : null);
    if (target) focusTarget(target);
  });
}

/**
 * The inspector's findings go as a group when their last one does (or the selection does): if focus was in them and
 * fell to the page, it goes to the inspector's body, which stays.
 */
export function useFallbackOnUnmount(list: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = list.current;
    return () => {
      const scope = el?.closest<HTMLElement>("[data-check-fallback-scope]");
      if (!el || !scope || !el.contains(document.activeElement)) return;
      queueMicrotask(() => {
        const active = document.activeElement;
        if (scope.isConnected && (!active || active === document.body)) focusTarget(scope);
      });
    };
  }, [list]);
}
