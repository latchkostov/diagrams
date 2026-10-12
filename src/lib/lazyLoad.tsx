import { lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { notify } from "../interop/ui/toast";

// Code that isn't needed for the first view loads on first use, and earlier on intent: when the menu that
// leads to it opens, on hover, or once the app is idle. Everything lazy goes through these two helpers,
// so each piece is downloaded once, a failed download is retried on the next use, and nothing that has
// already loaded waits a frame to show.

/** `load`, called at most once at a time: the result is shared, and a failure is forgotten so the next call retries. */
export function loadOnce<T>(load: () => Promise<T>): () => Promise<T> {
  let request: Promise<T> | undefined;
  return () =>
    (request ??= load().catch((error: unknown) => {
      request = undefined;
      throw error;
    }));
}

export type LazyComponent<P> = ((props: P) => ReactNode) & {
  /** Starts the download without waiting for it (safe to call often). */
  preload(): void;
};

const FAILED = "Part of the app couldn't be downloaded. Check your connection and try again, or reload the app.";

/**
 * A component whose code loads on first render, or earlier with `preload()`. Once loaded it renders in
 * the same frame as whatever shows it. While it loads it renders `fallback` (nothing by default) inside
 * its own Suspense boundary, so a pending download never blanks the view around it. A download that fails
 * renders nothing and says so in a toast; the next mount tries again.
 */
export function lazyComponent<P extends object>(
  load: () => Promise<ComponentType<P>>,
  fallback: ReactNode = null,
): LazyComponent<P> {
  let loaded: ComponentType<P> | undefined;
  const get = loadOnce(() =>
    load().then((component) => {
      loaded = component;
      return component;
    }),
  );
  function Lazy(props: P) {
    // Chosen once per mount: switching from the lazy wrapper to the loaded component later would remount it.
    const [Component] = useState<ComponentType<P>>(
      () =>
        loaded ??
        lazy<ComponentType<P>>(() =>
          get().then(
            (component) => ({ default: component }),
            (error: unknown) => {
              console.error("[diagrams] lazy load failed", error);
              notify(FAILED, { kind: "error" });
              return { default: () => null };
            },
          ),
        ),
    );
    return (
      <Suspense fallback={fallback}>
        <Component {...props} />
      </Suspense>
    );
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
