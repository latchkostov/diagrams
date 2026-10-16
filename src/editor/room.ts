import type { CanvasSnapshot } from "./useHistory";
import type { FlowSelection } from "./historySelection";
import type { CanvasPrivacyState } from "../lib/localOnly";

export type RoomRefusal =
  "key-too-long" | "string-too-long" | "too-deep" | "too-large" | "bad-id" | "room-full" | "private";
export type RoomCommitResult = { status: "applied" | "unchanged" } | { status: "refused"; reason: RoomRefusal };

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
    getPrivacy?(next: CanvasSnapshot): CanvasPrivacyState;
    detached?(): void;
    refused?(reason: RoomRefusal | undefined): void;
  }): () => void;
  commit(next: CanvasSnapshot, merge?: string, meta?: RoomStepMeta): RoomCommitResult;
  undo(): void;
  redo(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  newId(base: string): string;
  flushRemote(): void;
  checkPrivacy(): boolean;
  top(): string | undefined;
}
