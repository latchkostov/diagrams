import { useEffect, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { lazyComponent, loadOnce } from "../../lib/lazyLoad";
import type { MarkdownViewProps } from "./MarkdownView";

let renderer: typeof import("./MarkdownView") | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const snapshot = () => renderer;

/** Resolves only after mounted previews have swapped their escaped fallback for rendered Markdown. */
export const loadMarkdown = loadOnce(async () => {
  const module = await import("./MarkdownView");
  flushSync(() => {
    renderer = module;
    for (const listener of listeners) listener();
  });
  return module;
});

export function preloadMarkdown() {
  void loadMarkdown().catch(() => {});
}

/** Keep the parent's persisted canvas box and typography while the renderer downloads. */
export function MarkdownView({ text, className, testId }: MarkdownViewProps) {
  const loaded = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(preloadMarkdown, []);
  return loaded ? (
    <loaded.MarkdownView text={text} className={className} testId={testId} />
  ) : (
    <div
      className={`md-view${className ? ` ${className}` : ""}`}
      style={{ whiteSpace: "pre-wrap" }}
      data-testid={testId}
      data-markdown-pending=""
    >
      {text}
    </div>
  );
}

export const MarkdownEditor = lazyComponent(() => import("./MarkdownEditor").then((m) => m.MarkdownEditor));
