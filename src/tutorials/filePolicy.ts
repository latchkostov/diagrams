import type { DiagramFile } from "../model/types";
import type { SaveTarget } from "../lib/diagramIO";

/** The mounted file controller supplies the real parser pipeline; an unavailable demo fails into Retry. */
export function createPracticeImport() {
  let current: ((signal: AbortSignal) => Promise<void>) | undefined;
  return {
    connect(run: (signal: AbortSignal) => Promise<void>) {
      current = run;
      return () => {
        if (current === run) current = undefined;
      };
    },
    async run(signal: AbortSignal) {
      signal.throwIfAborted();
      if (!current) throw new Error("Practice import unavailable");
      await current(signal);
      signal.throwIfAborted();
    },
  };
}

/** Tutorial imports replace practice content; only an explicit library lesson copy acquires ownership. */
export function tutorialFilePolicy(
  lesson: string,
  ports: { replace(diagram: DiagramFile): void; copy(diagram: DiagramFile): string; cancel?(): void },
) {
  return {
    import(diagram: DiagramFile, _target?: SaveTarget) {
      if (lesson !== "import-and-review") return undefined;
      ports.cancel?.();
      ports.replace(structuredClone(diagram));
      return "tutorial";
    },
    saveCopy(diagram: DiagramFile) {
      if (lesson !== "library-reuse") return undefined;
      return ports.copy(structuredClone(diagram));
    },
  };
}
