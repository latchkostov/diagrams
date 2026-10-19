import type { CanvasSnapshot } from "./useHistory";
import type { FlowSelection } from "./historySelection";
import type { CanvasPrivacyState } from "../lib/localOnly";

export type RoomRefusal =
  "key-too-long" | "string-too-long" | "too-deep" | "too-large" | "bad-id" | "room-full" | "private" | "view-only";
export type RoomCommitResult = { status: "applied" | "unchanged" } | { status: "refused"; reason: RoomRefusal };

export interface RoomStepMeta {
  mergeKey?: string;
  start: FlowSelection;
}
export interface RoomHistoryResult {
  direction: "undo" | "redo";
  selection: FlowSelection;
}

/** Another person in the room, as the canvas draws them. */
export interface RoomPeer {
  /** Their session (not an identity: new on every join). */
  sender: string;
  /** The name they gave (unverified). */
  alias: string;
  /** A CSS colour; they're told apart by name too, never by colour alone. */
  colour: string;
  /** What they have selected (flow ids). */
  selection: readonly string[];
  /** Their pointer over the canvas, in flow coordinates. */
  cursor?: { x: number; y: number };
  /** How long until their cursor hides (it hasn't moved, or they're away); 0 or less: hidden now. */
  cursorHideIn: number;
}

/** Presence: who else is here and what they point at, and this person's own selection and pointer. */
export interface RoomPresence {
  subscribe(fn: () => void): () => void;
  /** Changes whenever peers() would say something else. */
  revision(): number;
  peers(): RoomPeer[];
  setSelection(ids: readonly string[]): void;
  setCursor(at: { x: number; y: number } | undefined): void;
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
  /** Presence, where the room has it. */
  readonly presence?: RoomPresence;
}
