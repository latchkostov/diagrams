import type { DiagramFile } from "../model/types";
import type { ImportResult } from "../interop/importResult";
import type { SaveTarget } from "../lib/diagramIO";

/** Mounted file controls connect after render; reference actions fail into Retry when unavailable. */
export function createPracticeExports() {
  let current:
    { share(): void; export(format: "svg" | "png" | "html", signal: AbortSignal): Promise<void> } | undefined;
  return {
    connect(next: NonNullable<typeof current>) {
      current = next;
      return () => {
        if (current === next) current = undefined;
      };
    },
    share() {
      if (!current) throw new Error("Sharing unavailable");
      current.share();
    },
    run(format: "svg" | "png" | "html", signal: AbortSignal) {
      signal.throwIfAborted();
      if (!current) throw new Error("Export unavailable");
      return current.export(format, signal);
    },
  };
}

/** The mounted file controller supplies the real parser pipeline; an unavailable demo fails into Retry. */
export function createPracticeImport() {
  let current: ((signal: AbortSignal) => Promise<ImportResult>) | undefined;
  return {
    connect(run: (signal: AbortSignal) => Promise<ImportResult>) {
      current = run;
      return () => {
        if (current === run) current = undefined;
      };
    },
    async run(signal: AbortSignal) {
      signal.throwIfAborted();
      if (!current) throw new Error("Practice import unavailable");
      const result = await current(signal);
      signal.throwIfAborted();
      if (result.status === "failure") throw new Error("Practice import failed");
      if (result.status === "cancelled") throw new DOMException("Practice import cancelled", "AbortError");
    },
  };
}

/** Privacy belongs to the mounted practice session, never a library entry or browser storage. */
export function createPracticePrivacy() {
  let flags: Readonly<{ private: boolean; onDevice?: boolean }> = { private: false };
  const listeners = new Set<() => void>();
  return {
    get: () => flags,
    setPrivate(on: boolean) {
      // Private content can still be recovered through Undo after a public import.
      if (!on || flags.private) return;
      flags = { private: on };
      for (const listener of listeners) listener();
    },
    setOnDevice(on: boolean) {
      if (!flags.private || !!flags.onDevice === on) return;
      flags = { ...flags, onDevice: on };
      for (const listener of listeners) listener();
    },
    reset() {
      flags = { private: false };
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
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
