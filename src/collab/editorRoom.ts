import { fromFlow, toFlow } from "../canvas/convert";
import type { EditorRoom, RoomStepMeta } from "../editor/room";
import { selectionAfterRedo, selectionAfterUndo, selectionOf } from "../editor/historySelection";
import type { CanvasSnapshot } from "../editor/useHistory";
import type { CanvasPrivacyState } from "../lib/localOnly";
import { EditorBinding } from "./binding";
import type { CollabSession } from "./session";

const STEP = Symbol("editor-step");
interface LocalStep extends RoomStepMeta {
  capture?: string;
}

/** Real editor adapter; the Lab owns the session lifetime, independently of a mounted canvas. */
export class CollaborativeEditorRoom implements EditorRoom {
  private binding?: EditorBinding;
  private committed?: CanvasSnapshot;
  private port?: Parameters<EditorRoom["connect"]>[0];
  private stepping = false;
  private stepped?: CanvasSnapshot;

  constructor(
    readonly session: CollabSession,
    private readonly privacy: () => CanvasPrivacyState,
  ) {}

  connect(port: Parameters<EditorRoom["connect"]>[0]): () => void {
    this.port = port;
    const binding = new EditorBinding(
      this.session,
      {
        getDiagram: () => {
          const s = this.committed ?? port.getSnapshot();
          return fromFlow(s.meta, s.nodes, s.edges);
        },
        applyDiagram: (next) => {
          const snapshot = toFlow(next);
          if (this.stepping) this.stepped = snapshot;
          else port.receive(snapshot);
        },
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
      if (this.binding === binding) {
        this.binding = undefined;
        this.port = undefined;
      }
    };
  }

  commit(next: CanvasSnapshot, merge?: string, meta?: RoomStepMeta): void {
    const previous = this.session.doc.undoManager.undoStack.at(-1);
    this.committed = next;
    try {
      this.binding?.localChanged({ merge });
      const top = this.session.doc.undoManager.undoStack.at(-1);
      const old = top?.meta.get(STEP) as LocalStep | undefined;
      if (top && meta && (top !== previous || (old && old.capture === merge)))
        top.meta.set(STEP, {
          ...meta,
          start: old && old.capture === merge ? old.start : meta.start,
          capture: merge,
        } satisfies LocalStep);
    } finally {
      this.committed = undefined;
    }
  }

  undo() {
    this.step("undo");
  }
  redo() {
    this.step("redo");
  }
  private step(direction: "undo" | "redo") {
    const port = this.port;
    if (!port || !this.binding) return;
    const manager = this.session.doc.undoManager;
    const item = (direction === "undo" ? manager.undoStack : manager.redoStack).at(-1);
    const meta = item?.meta.get(STEP) as LocalStep | undefined;
    const before = port.getSnapshot();
    this.stepping = true;
    this.stepped = undefined;
    let changed: boolean;
    try {
      changed = this.binding[direction]();
    } finally {
      this.stepping = false;
    }
    if (!changed) return;
    const inverse = (direction === "undo" ? manager.redoStack : manager.undoStack).at(-1);
    if (inverse && meta) inverse.meta.set(STEP, meta);
    const projected = this.session.doc.project();
    const next = this.stepped ?? (projected.diagram ? toFlow(projected.diagram) : undefined);
    if (!next) return;
    const current = selectionOf(before);
    const selection =
      direction === "undo"
        ? selectionAfterUndo(before, next, current, meta?.start)
        : selectionAfterRedo(before, next, current, meta?.start);
    port.receive(next, { direction, selection });
  }
  top(): string | undefined {
    return (this.session.doc.undoManager.undoStack.at(-1)?.meta.get(STEP) as LocalStep | undefined)?.mergeKey;
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
