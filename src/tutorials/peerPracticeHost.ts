import type { EditorApi } from "../editor/types";
import type { createLocalPeerPractice, PeerAction } from "./localPeerPractice";

declare const __DEPLOYMENT_COLLAB__: boolean;
const loadPractice =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1" || __DEPLOYMENT_COLLAB__
    ? () => import("./localPeerPractice")
    : undefined;

/** The collaboration fixture stays outside the tutorial hub/content chunk until explicitly started. */
export function createPeerPracticeHost() {
  type Practice = ReturnType<typeof createLocalPeerPractice>;
  let current: Practice | undefined;
  let generation = 0;
  let off: (() => void) | undefined;
  let snapshot: ReturnType<Practice["getSnapshot"]> = { value: "idle" };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = current?.getSnapshot() ?? { value: "idle" };
    listeners.forEach((f) => f());
  };
  const reset = () => {
    generation++;
    off?.();
    off = undefined;
    current?.dispose();
    current = undefined;
    publish();
  };
  return {
    reset,
    getSnapshot: () => snapshot,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
    async run(action: PeerAction, editor: EditorApi, signal: AbortSignal) {
      if (!loadPractice) throw new Error("Practice peers unavailable in this build");
      const request = generation;
      const module = await loadPractice();
      signal.throwIfAborted();
      if (request !== generation) throw new DOMException("Cancelled", "AbortError");
      if (!current) {
        current = module.createLocalPeerPractice();
        off = current.subscribe(publish);
      }
      await current.run(action, editor, signal);
      signal.throwIfAborted();
    },
  };
}
