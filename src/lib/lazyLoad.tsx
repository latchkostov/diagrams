import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { notify } from "../interop/ui/toast";
import { t } from "../i18n/core";

// Code that isn't needed for the first view loads on first use, and earlier on intent: when the menu that
// leads to it opens, on hover, or once the app is idle. Everything lazy goes through these helpers, so each
// piece is downloaded once, a failed download can be retried where it failed, and nothing that has already
// loaded waits a frame to show.

/** `load`, called at most once at a time: the result is shared, and a failure is forgotten so the next call retries. */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let request: Promise<T> | undefined;
  return () =>
    (request ??= load().catch((error: unknown) => {
      request = undefined;
      throw error;
    }));
}

/** Where a lazy component's download is, for what stands in for it until it arrives. */
export interface LoadStatus {
  /** The download failed: `retry` starts it again (the component stays mounted). */
  failed: boolean;
  retry(): void;
}

/** What renders while the code downloads, or after the download failed: given the component's own props. */
export type Placeholder<P> = (props: P, status: LoadStatus) => ReactNode;

export type LazyComponent<P> = ((props: P) => ReactNode) & {
  /** Starts the download without waiting for it (safe to call often). */
  preload(): void;
};

export const LOAD_FAILED = "Part of the app couldn't be downloaded. Check your connection and try again.";

/** Says a download failed, in a toast whose Retry runs `retry`: the way back ships with the app, not what failed. */
export function loadFailed(retry: () => void) {
  notify(t("ai.loadFailed"), {
    kind: "error",
    action: { label: t("common.retry"), run: retry, testId: "lazy-load-retry" },
  });
}

/**
 * A component whose code loads on first render, or earlier with `preload()`. Once loaded it renders in the
 * same frame as whatever shows it. Until then it renders `placeholder` (a dialog passes a modal frame that
 * Esc and Close dismiss), never blanking the view around it. A failed download is recoverable where it is:
 * the placeholder offers Retry, or, without one (or with `toast`: a placeholder that only says it's loading), a toast
 * does; unmounting and mounting again retries too.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
  placeholder?: Placeholder<P>,
  toast = !placeholder,
): LazyComponent<P> {
  let loaded: ComponentType<P> | undefined;
  const get = loadOnce(() =>
    load().then((component) => {
      loaded = component;
      return component;
    }),
  );
  function Lazy(props: P) {
    const [state, setState] = useState<{ component?: ComponentType<P>; failed: boolean; attempt: number }>(() => ({
      component: loaded,
      failed: false,
      attempt: 0,
    }));
    const { component, failed, attempt } = state;
    useEffect(() => {
      if (component || failed) return;
      let active = true;
      get().then(
        (c) => active && setState((s) => ({ ...s, component: c })),
        (error: unknown) => {
          console.error("[diagrams] lazy load failed", error);
          if (active) setState((s) => ({ ...s, failed: true }));
        },
      );
      return () => {
        active = false;
      };
    }, [component, failed, attempt]);
    const retry = useCallback(() => setState((s) => ({ failed: false, attempt: s.attempt + 1 })), []);
    // Without a placeholder that offers Retry, the failure is reported (with Retry) in a toast.
    useEffect(() => {
      if (failed && toast) loadFailed(retry);
    }, [failed, retry]);
    if (component) {
      const Component = component;
      return <Component {...props} />;
    }
    return placeholder ? placeholder(props, { failed, retry }) : null;
  }
  Lazy.preload = () => void get().catch(() => {});
  return Lazy;
}

/**
 * Runs `fn` when the browser is next idle after `delay` ms (2 s later at the latest), so background
 * downloads start once the first view is up instead of competing with it. Returns a cancel function.
 */
export function whenIdle(fn: () => void, delay = 1500): () => void {
  let cancel = () => {};
  const timer = setTimeout(() => {
    if (typeof requestIdleCallback !== "function") return fn();
    const id = requestIdleCallback(fn, { timeout: 2000 });
    cancel = () => cancelIdleCallback(id);
  }, delay);
  return () => {
    clearTimeout(timer);
    cancel();
  };
}
