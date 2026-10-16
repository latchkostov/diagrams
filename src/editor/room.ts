import type { CanvasSnapshot } from "./useHistory";

/** Optional room driver. The ordinary editor has no dependency on a collaboration implementation. */
export interface EditorRoom {
  connect(port: {
    getSnapshot(): CanvasSnapshot;
    flushPending(): boolean;
    receive(next: CanvasSnapshot): void;
  }): () => void;
  commit(next: CanvasSnapshot, merge?: string): void;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  newId(base: string): string;
  flushRemote(): void;
}
