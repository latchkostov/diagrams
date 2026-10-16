import type { CanvasSnapshot } from "./useHistory";
import type { FlowSelection } from "./historySelection";

export interface RoomStepMeta {
  mergeKey?: string;
  start: FlowSelection;
}
export interface RoomHistoryResult {
  direction: "undo" | "redo";
  selection: FlowSelection;
}

/** Optional room driver. The ordinary editor has no dependency on a collaboration implementation. */
export interface EditorRoom {
  connect(port: {
    getSnapshot(): CanvasSnapshot;
    flushPending(): boolean;
    receive(next: CanvasSnapshot, step?: RoomHistoryResult): void;
  }): () => void;
  commit(next: CanvasSnapshot, merge?: string, meta?: RoomStepMeta): void;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  newId(base: string): string;
  flushRemote(): void;
  top(): string | undefined;
}
