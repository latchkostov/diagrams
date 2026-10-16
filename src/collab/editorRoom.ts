import { fromFlow, toFlow } from "../canvas/convert";
import type { EditorRoom } from "../editor/room";
import type { CanvasSnapshot } from "../editor/useHistory";
import type { CanvasPrivacyState } from "../lib/localOnly";
import { EditorBinding } from "./binding";
import type { CollabSession } from "./session";

/** Real editor adapter; the Lab owns the session lifetime, independently of a mounted canvas. */
export class CollaborativeEditorRoom implements EditorRoom {
  private binding?: EditorBinding;
  private committed?: CanvasSnapshot;

  constructor(
    readonly session: CollabSession,
    private readonly privacy: () => CanvasPrivacyState,
  ) {}

  connect(port: Parameters<EditorRoom["connect"]>[0]): () => void {
    const binding = new EditorBinding(
      this.session,
      {
        getDiagram: () => {
          const s = this.committed ?? port.getSnapshot();
          return fromFlow(s.meta, s.nodes, s.edges);
        },
        applyDiagram: (next) => port.receive(toFlow(next)),
        normalize: (next) => {
          const s = toFlow(next);
          return fromFlow(s.meta, s.nodes, s.edges);
        },
        flushPending: () => port.flushPending(),
      },
      this.privacy,
    );
    this.binding = binding;
    return () => {
      // Detach only: React StrictMode may mount the editor again on this same session.
      binding.detach();
      if (this.binding === binding) this.binding = undefined;
    };
  }

  commit(next: CanvasSnapshot, merge?: string): void {
    this.committed = next;
    try {
      this.binding?.localChanged({ merge });
    } finally {
      this.committed = undefined;
    }
  }

  undo() {
    this.binding?.undo();
  }
  redo() {
    this.binding?.redo();
  }
  flushRemote() {
    this.binding?.flushRemote();
  }
  get canUndo() {
    return this.session.doc.undoManager.canUndo();
  }
  get canRedo() {
    return this.session.doc.undoManager.canRedo();
  }
  newId(base: string) {
    return this.session.newId(base);
  }
}
