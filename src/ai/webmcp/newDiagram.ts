import type { EditorApi } from "../../editor/types";

// new_diagram's part that waits: open a new diagram, wait for its editor, then give it the agent's title and
// direction. Kept apart from the bridge (a component) so the waiting can be tested.

export interface NewDiagramHost {
  /** The editor of the diagram open now. */
  currentEditor(): EditorApi | null;
  /** AI tools may change the diagram open now (not Private, not local-only, the copy allows them). */
  canUseAi(): boolean;
  /** The open diagram's identity: it survives the draft becoming a Your diagrams entry, not another diagram opening. */
  documentId(): string | undefined;
  /** Called whenever the open diagram (or its editor) may have changed. */
  subscribe(listener: () => void): () => void;
  /** Starts the new diagram (File ▸ New diagram). */
  open(): void;
  /** Waits for the meta edit to land (the next render; it may promote the draft into Your diagrams). */
  settle(): Promise<void>;
}

/** Resolves with the editor of the diagram that opens after `previous` (null when none does in time). */
function nextEditor(host: NewDiagramHost, previous: EditorApi | null, timeoutMs: number): Promise<EditorApi | null> {
  return new Promise((resolve) => {
    const done = (e: EditorApi | null) => {
      off();
      clearTimeout(timer);
      resolve(e);
    };
    const off = host.subscribe(() => {
      const e = host.currentEditor();
      if (e && e !== previous) done(e);
    });
    const timer = setTimeout(() => {
      const e = host.currentEditor();
      done(e && e !== previous ? e : null);
    }, timeoutMs);
  });
}

/**
 * Opens a new diagram and gives it `title` and `direction`. Only the diagram it opened, and only while AI may change
 * it: a new diagram that starts Private ("New diagrams are private") is never written to, and nothing is written to
 * the diagram that was open before when the new one is slow to come (or another one opens instead and is Private).
 * Null when no new diagram opened, or another one replaced it while the title landed (it isn't the agent's to claim).
 */
export async function openNewDiagram(
  host: NewDiagramHost,
  { title, direction }: { title?: string; direction?: "LR" | "TB" },
  timeoutMs = 4000,
): Promise<EditorApi | null> {
  const before = host.currentEditor();
  const opened = nextEditor(host, before, timeoutMs);
  host.open();
  const editor = await opened;
  if (!editor) return null;
  if (!(title || direction) || !host.canUseAi() || host.currentEditor() !== editor) return editor;
  const doc = host.documentId();
  editor.updateMeta({ ...(title ? { title } : {}), ...(direction ? { direction } : {}) });
  await host.settle();
  // The same document (a draft promoted to an entry keeps its identity), or nothing.
  if (host.documentId() !== doc) return null;
  return host.currentEditor() ?? editor;
}
