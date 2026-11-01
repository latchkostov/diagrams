import type { EditorApi } from "../editor/types";
import { canUseAiTools } from "../lib/localOnly";
import { paletteHost } from "../palette/host";

declare const __DEPLOYMENT_AI_TOOLS__: boolean;
const loadPractice =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1" || __DEPLOYMENT_AI_TOOLS__
    ? () => import("./agentPractice")
    : undefined;

/** The mounted practice owns conversation cleanup and retryable lazy initialization. */
export function createAgentPracticeHost(documentId: string, load = loadPractice) {
  let generation = 0;
  let connected = false;
  let module: Awaited<ReturnType<NonNullable<typeof load>>> | undefined;
  let ready: Promise<NonNullable<typeof module>> | undefined;
  const reset = () => {
    generation++;
    ready = undefined;
    module?.resetAgentPractice(documentId);
    if (connected) void prepare().catch(() => {});
  };
  const prepare = () => {
    if (ready) return ready;
    const request = generation;
    const pending = (async () => {
      if (!load) throw new Error("Practice AI unavailable in this build");
      const loaded = await load();
      if (request !== generation) throw new DOMException("Cancelled", "AbortError");
      module = loaded;
      loaded.resetAgentPractice(documentId);
      return loaded;
    })();
    ready = pending;
    void pending.catch(() => {
      if (ready === pending) ready = undefined;
    });
    return pending;
  };
  return {
    reset,
    connect() {
      connected = true;
      void prepare().catch(() => {});
      return () => {
        connected = false;
        reset();
      };
    },
    async run(action: "add" | "rename" | "undo" | "revert", editor: EditorApi, signal: AbortSignal) {
      signal.throwIfAborted();
      const request = generation;
      const practice = await prepare();
      signal.throwIfAborted();
      if (request !== generation) throw new DOMException("Cancelled", "AbortError");
      if (!canUseAiTools(paletteHost.get().canvas)) throw new Error("Practice AI unavailable for this diagram");
      practice.agentPractice(editor, documentId, action);
    },
    async open(signal: AbortSignal) {
      if (!loadPractice) throw new Error("Practice AI unavailable in this build");
      const dock = await import("../ai/ui/dock");
      signal.throwIfAborted();
      dock.aiDock.set({ open: true });
    },
    async copy(signal: AbortSignal) {
      if (!loadPractice) throw new Error("Practice AI unavailable in this build");
      const [copy, prompt, privacy, dock] = await Promise.all([
        import("../ai/ui/copyContext"),
        import("../ai/ui/prompt"),
        import("../ai/privacy"),
        import("../ai/ui/dock"),
      ]);
      signal.throwIfAborted();
      const canvas = paletteHost.get().canvas;
      if (!canvas || !canUseAiTools(canvas)) throw new Error("Practice AI unavailable for this diagram");
      dock.aiDock.set({ open: true });
      const text = prompt.buildPrompt({ request: "", describe: privacy.describeForAi(canvas.editor, canvas) });
      if (!(await copy.copyAiContext(text, signal))) throw new Error("Clipboard unavailable");
    },
  };
}
