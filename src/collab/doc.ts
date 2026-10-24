import * as Y from "yjs";
import type { DiagramFile } from "../model/types";
import { applyCommands, type DiagramCommand } from "./commands";
import {
  checkCommands,
  inspectUpdate,
  inspectCheckpoint,
  type GuardResult,
  type GuardProblem,
  type LocalProblem,
} from "./guard";
import { COLLAB_LIMITS } from "./limits";
import {
  assemble,
  hydrate,
  META,
  metaOf,
  orderOf,
  projectMeta,
  projectRecord,
  RECORD_KINDS,
  orderRoot,
  orderedIds,
  recordsOf,
  validateProjection,
  type RecordKind,
} from "./schema";

// One person's copy of a room's diagram: the Yjs document, the projection back to a DiagramFile (cached per record,
// so a remote edit to one node re-reads one node), and that person's Undo, which tracks only their own commands.
//
// Origins: LOCAL (this person's commands: tracked by Undo), REMOTE (peers' updates), HYDRATE (the room's initial
// copy: not undoable, so nobody's first Undo empties the room).

export const REMOTE = Symbol("collab:remote");
export const HYDRATE = Symbol("collab:hydrate");
/** Values an Undo (or Redo) meant to restore but Yjs couldn't (see `restoreRefused`). Not undoable themselves. */
export const RESTORE = Symbol("collab:restore");

/** Yjs exports DeleteSet as a value but not its type. */
type DeleteSet = Parameters<typeof Y.iterateDeletedStructs>[1];
type DeleteItem = DeleteSet["clients"] extends Map<number, (infer I)[]> ? I : never;
type StackItemLike = { insertions: DeleteSet; deletions: DeleteSet };

// Each incoming struct can add at most four missing-client entries (its own clock,
// origin, right origin and parent). Reserve two numeric words per entry before Yjs
// applies it. Unlike encoded pending structs, these entries do not deduplicate.
const DEPENDENCY_BYTES_PER_STRUCT = 4 * 16;

export type Projection =
  | { status: "ok"; diagram: DiagramFile; warnings: string[]; hidden: string[] }
  | {
      /** The shared state doesn't validate (see ./schema.ts). `diagram` is the last valid one, if any. */
      status: "invalid";
      error: string;
      diagram: DiagramFile | undefined;
      hidden: string[];
    };

/** A diagram too large (or with values too long or deep) for a room. */
export class CollabLimitError extends Error {
  constructor(readonly problem: string) {
    super(`This diagram is beyond what a room can carry (${problem}).`);
    this.name = "CollabLimitError";
  }
}

export interface DocStats {
  /** Records read back from shared state since the document was made (a cache miss each). */
  recordsProjected: number;
  /** Full projections (assemble + validate). */
  projections: number;
  /** Local transactions (one per editor step). */
  localTransactions: number;
  /** Remote updates applied, and refused by the guard. */
  remoteApplied: number;
  remoteRefused: number;
  /** Exact measurements of the room's encoded size (each encodes the whole document). */
  roomMeasurements: number;
}

export interface CollabDocOptions {
  /** Yjs client id (tests pin it so a seeded schedule replays exactly). */
  clientId?: number;
}

export type RemoteProblem = GuardProblem | "apply-failed" | "peer-full" | "room-full" | "too-many-peers";

export class CollabDoc {
  readonly ydoc: Y.Doc;
  readonly undoManager: Y.UndoManager;
  /** This person's commands' origin (an object, so it can't be forged by a string from the wire). */
  readonly local = { collab: "local" } as const;
  readonly stats: DocStats = {
    recordsProjected: 0,
    projections: 0,
    localTransactions: 0,
    remoteApplied: 0,
    remoteRefused: 0,
    roomMeasurements: 0,
  };

  private cache = new Map<RecordKind, Map<string, Record<string, unknown> | undefined>>();
  private dirty = new Map<RecordKind, Set<string>>();
  private listDirty = new Set<RecordKind>(RECORD_KINDS);
  private metaDirty = true;
  private lists = new Map<RecordKind, Record<string, unknown>[]>();
  private current: Projection | undefined;
  private lastGood: DiagramFile | undefined;
  private lastMerge: string | undefined;
  private listeners = new Set<() => void>();
  /**
   * An upper bound on the retained state: its measured size (at `measuredAt`, a revision), plus
   * every change since. Measured again only when the bound nears the limit and the document has changed since.
   */
  private roomBytes = 0;
  /** Missing-dependency bookkeeping is absent from Yjs encodings. Reclaim only once pending structs drain. */
  private pendingDependencyBytes = 0;
  private revision = 0;
  private measuredAt = -1;
  /** Conservative retained-state contributions, keyed by authenticated transport sender (not Yjs client id). */
  private peerBytes = new Map<string, number>();
  private proofCache?: { revision: number; value: Promise<Uint8Array> };
  /** Estimated bytes of each Undo/Redo step (local steps: their checked bound; Undo's own: what it reversed). */
  private stepSizes = new WeakMap<object, number>();
  private stepBytes = 0;
  private poppedBytes = 0;

  private measureRoom(): void {
    if (this.measuredAt !== this.revision) {
      this.roomBytes = Y.encodeStateAsUpdate(this.ydoc).length + this.pendingDependencyBytes;
      this.measuredAt = this.revision;
      this.stats.roomMeasurements++;
    }
  }

  private roomHas(bytes: number): boolean {
    if (this.roomBytes + bytes <= COLLAB_LIMITS.maxRoomBytes) return true;
    this.measureRoom();
    return this.roomBytes + bytes <= COLLAB_LIMITS.maxRoomBytes;
  }

  /** Keeps the Undo history within its byte and step budgets, dropping the oldest steps (and freeing what they kept). */
  private trimHistory(): void {
    const um = this.undoManager;
    const size = (item: object) => this.stepSizes.get(item) ?? 0;
    let total = [...um.undoStack, ...um.redoStack].reduce((n, item) => n + size(item), 0);
    while (
      um.undoStack.length + um.redoStack.length > 1 &&
      (total > COLLAB_LIMITS.maxHistoryBytes ||
        um.undoStack.length + um.redoStack.length > COLLAB_LIMITS.maxHistorySteps)
    ) {
      const oldest = um.undoStack.length > 1 ? um.undoStack.shift()! : um.redoStack.shift()!;
      total -= size(oldest);
      this.release(oldest);
    }
  }

  /** Lets Yjs collect what a dropped step was keeping for Undo. */
  private release(item: StackItemLike): void {
    this.ydoc.transact((tr) => {
      Y.iterateDeletedStructs(tr, item.deletions, (struct) => {
        if (struct instanceof Y.Item) struct.keep = false;
      });
    });
    Y.tryGc(item.deletions, this.ydoc.store, () => true);
  }

  constructor(opts: CollabDocOptions = {}) {
    this.ydoc = new Y.Doc();
    if (opts.clientId !== undefined) this.ydoc.clientID = opts.clientId;
    for (const kind of RECORD_KINDS) {
      this.cache.set(kind, new Map());
      this.dirty.set(kind, new Set());
    }
    const scope = [metaOf(this.ydoc), ...RECORD_KINDS.flatMap((k) => [recordsOf(this.ydoc, k), orderOf(this.ydoc, k)])];
    // Steps merge only when the caller says so (an explicit merge tag), never by timing.
    this.undoManager = new Y.UndoManager(scope, {
      trackedOrigins: new Set([this.local]),
      captureTimeout: Number.MAX_SAFE_INTEGER,
    });
    this.ydoc.on("afterTransaction", (tr: Y.Transaction) => this.track(tr));
    const sized = ({ stackItem, type }: { stackItem: object; type: "undo" | "redo" }) => {
      // A local step adds its bound; a step made by Undo or Redo carries the size of the one it reversed.
      const add = this.undoManager.undoing || this.undoManager.redoing ? this.poppedBytes : this.stepBytes;
      this.stepSizes.set(stackItem, (this.stepSizes.get(stackItem) ?? 0) + add);
      void type;
      this.trimHistory();
    };
    this.undoManager.on("stack-item-added", sized);
    this.undoManager.on("stack-item-updated", sized);
  }

  /** Called after every change to the shared state (local, remote, undo); read `project()` for the result. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The room creator's initial copy. Only into an empty document. Built in a scratch document first and checked by
   * the same guard as a peer's update, so a diagram the room would refuse never becomes the room's.
   */
  hydrate(diagram: DiagramFile): void {
    if (!this.isEmpty()) throw new Error("A room's document is hydrated once, by its creator.");
    const scratch = new Y.Doc();
    scratch.transact(() => hydrate(scratch, diagram));
    const update = Y.encodeStateAsUpdate(scratch);
    scratch.destroy();
    const check = inspectUpdate(update);
    if (!check.ok) throw new CollabLimitError(check.problem);
    // Checked; now written under this document's own client id (applying the scratch update would make Yjs see
    // its id arrive from elsewhere and pick a new one).
    this.ydoc.transact(() => hydrate(this.ydoc, diagram), HYDRATE);
    this.roomBytes = update.length;
  }

  isEmpty(): boolean {
    return Y.encodeStateVector(this.ydoc).length <= 1;
  }

  /**
   * One editor step, as one transaction and one Undo step. `merge` joins it to the previous step when both carry
   * the same tag (typing a label), the way the editor's own history does; anything else starts a new step.
   */
  apply(
    commands: readonly DiagramCommand[],
    opts: { merge?: string } = {},
  ): { ok: true } | { ok: false; problem: LocalProblem } {
    if (!commands.length) return { ok: true };
    const check = checkCommands(commands);
    if (!check.ok) return check;
    if (!this.roomHas(check.bytes)) return { ok: false, problem: "room-full" };
    if (opts.merge === undefined || opts.merge !== this.lastMerge) this.undoManager.stopCapturing();
    this.lastMerge = opts.merge;
    this.stats.localTransactions++;
    this.stepBytes = check.bytes;
    this.ydoc.transact(() => applyCommands(this.ydoc, commands), this.local);
    this.stepBytes = 0;
    this.roomBytes += check.bytes;
    return { ok: true };
  }

  /** Applies a peer's update after the guard's state-independent checks. */
  applyRemote(update: Uint8Array, sender = "remote"): { ok: true } | { ok: false; problem: RemoteProblem } {
    return this.applyChecked(update, inspectUpdate(update), sender);
  }

  applyCheckpoint(update: Uint8Array): { ok: true } | { ok: false; problem: RemoteProblem } {
    return this.applyChecked(update, inspectCheckpoint(update), "checkpoint");
  }

  /** A new transport epoch retires sender slots, while all retained-state charges stay with the document. */
  restartSenders(): void {
    this.peerBytes.clear();
  }

  private applyChecked(
    update: Uint8Array,
    check: GuardResult,
    sender: string,
  ): { ok: true } | { ok: false; problem: RemoteProblem } {
    if (!check.ok) {
      this.stats.remoteRefused++;
      return { ok: false, problem: check.problem };
    }
    try {
      let contribution = this.peerBytes.get(sender) ?? 0;
      let dependencyBytes = check.structs * DEPENDENCY_BYTES_PER_STRUCT;
      let bytes = update.length + dependencyBytes;
      let problem: RemoteProblem | undefined;
      if (!this.peerBytes.has(sender) && this.peerBytes.size >= COLLAB_LIMITS.maxSenders) problem = "too-many-peers";
      // Leave headroom beyond the local soft budget for concurrent edits and a full sync reply. The
      // hard budgets are one message's worth per sender and two in total, including pending Yjs state.
      if (
        contribution + bytes > COLLAB_LIMITS.maxMessageBytes ||
        this.roomBytes + bytes > 2 * COLLAB_LIMITS.maxMessageBytes
      ) {
        this.measureRoom();
        // The entire retained document also bounds any sender's retained contribution. This reclaims
        // conservative charges for duplicate sync replies and garbage-collected replacements.
        contribution = Math.min(contribution, this.roomBytes);
        // Repeated sync replies carry already-integrated structs. Charge and apply only what is missing.
        update = Y.diffUpdate(update, this.stateVector());
        dependencyBytes = Y.decodeUpdate(update).structs.length * DEPENDENCY_BYTES_PER_STRUCT;
        bytes = update.length + dependencyBytes;
        if (contribution + bytes > COLLAB_LIMITS.maxMessageBytes) problem = "peer-full";
        else if (this.roomBytes + bytes > 2 * COLLAB_LIMITS.maxMessageBytes) problem = "room-full";
      }
      if (problem) {
        this.stats.remoteRefused++;
        return { ok: false, problem };
      }
      Y.applyUpdate(this.ydoc, update, REMOTE);
      this.pendingDependencyBytes = this.ydoc.store.pendingStructs ? this.pendingDependencyBytes + dependencyBytes : 0;
      this.roomBytes += bytes;
      this.peerBytes.set(sender, contribution + bytes);
    } catch {
      this.stats.remoteRefused++;
      return { ok: false, problem: "apply-failed" };
    }
    this.stats.remoteApplied++;
    return { ok: true };
  }

  undo(): boolean {
    this.lastMerge = undefined;
    this.poppedBytes = this.stepSizes.get(this.undoManager.undoStack.at(-1) ?? {}) ?? 0;
    const item = this.undoManager.undo();
    // The Undo pushed its own step onto the redo stack; values it restores belong to that step.
    if (item) this.restoreRefused(item, this.undoManager.redoStack.at(-1));
    return item !== null;
  }

  redo(): boolean {
    this.lastMerge = undefined;
    this.poppedBytes = this.stepSizes.get(this.undoManager.redoStack.at(-1) ?? {}) ?? 0;
    const item = this.undoManager.redo();
    if (item) this.restoreRefused(item, this.undoManager.undoStack.at(-1));
    return item !== null;
  }

  /**
   * Yjs restores a field's earlier value on Undo only when no one else wrote that field meanwhile; when someone did
   * and their value has since been overwritten too, the field ends up with no value at all (a node without a
   * position, a diagram without a title). For each field this step replaced, if it's now empty, write back the value
   * the step replaced, as a new change everyone receives. A field someone else currently holds is left alone.
   */
  private restoreRefused(step: StackItemLike, inverse: StackItemLike | undefined): void {
    const restores: [Y.Map<unknown>, string, unknown][] = [];
    this.ydoc.transact((tr) => {
      Y.iterateDeletedStructs(tr, step.deletions, (struct) => {
        if (!(struct instanceof Y.Item) || struct.parentSub === null || Y.isDeleted(step.insertions, struct.id)) return;
        if (!(struct.content instanceof Y.ContentAny)) return;
        const parent = struct.parent;
        if (!(parent instanceof Y.Map) || parent._item?.deleted || parent.has(struct.parentSub)) return;
        restores.push([parent as Y.Map<unknown>, struct.parentSub, struct.content.getContent().at(-1)]);
      });
    });
    if (!restores.length) return;
    const client = this.ydoc.clientID;
    const from = Y.getState(this.ydoc.store, client);
    this.ydoc.transact(() => restores.forEach(([map, key, value]) => map.set(key, value)), RESTORE);
    const to = Y.getState(this.ydoc.store, client);
    // The restored values count as part of the Undo (or Redo) itself, so the next Redo (or Undo) takes them back
    // like anything else it inserted, instead of seeing them as someone's later change to leave alone.
    if (inverse && to > from) {
      const added = Y.createDeleteSet();
      added.clients.set(client, [{ clock: from, len: to - from } as DeleteItem]);
      inverse.insertions = Y.mergeDeleteSets([inverse.insertions, added]);
    }
  }

  canUndo = () => this.undoManager.canUndo();
  canRedo = () => this.undoManager.canRedo();

  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /** A sync proof includes deletions: state vectors alone cannot acknowledge a delete. */
  async syncProof(): Promise<Uint8Array> {
    if (this.proofCache?.revision === this.revision) return this.proofCache.value;
    const clocks = [...Y.decodeStateVector(this.stateVector())].sort(([a], [b]) => a - b);
    const deletes = [...Y.createDeleteSetFromStructStore(this.ydoc.store).clients]
      .sort(([a], [b]) => a - b)
      .map(([id, ranges]) => [id, ranges.map((r) => [r.clock, r.len])]);
    const bytes = new TextEncoder().encode(JSON.stringify([clocks, deletes]));
    const value = crypto.subtle.digest("SHA-256", bytes).then((hash) => new Uint8Array(hash));
    this.proofCache = { revision: this.revision, value };
    return value;
  }

  /** What a peer with state vector `sv` lacks (everything, without one). */
  encodeDiff(sv?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, sv);
  }

  /**
   * The same as one or more updates of at most `max` bytes each where possible: split by Yjs client (each part
   * names everything but one client as already known). A single client's part larger than `max` stays whole.
   */
  encodeDiffParts(sv: Uint8Array | undefined, max: number): Uint8Array[] {
    const whole = this.encodeDiff(sv);
    if (whole.length <= max) return [whole];
    const theirs = sv ? Y.decodeStateVector(sv) : new Map<number, number>();
    const ours = Y.decodeStateVector(this.stateVector());
    const missing = [...ours.keys()].filter((c) => (theirs.get(c) ?? 0) < ours.get(c)!);
    // Halve the set of clients until each part fits: a few encodings per part, not one per client.
    const parts: Uint8Array[] = [];
    const encode = (clients: number[]) => {
      const target = new Map(ours);
      for (const c of clients) target.set(c, theirs.get(c) ?? 0);
      return Y.encodeStateAsUpdate(this.ydoc, encodeStateVector(target));
    };
    const split = (clients: number[], encoded?: Uint8Array) => {
      const part = encoded ?? encode(clients);
      if (part.length <= max || clients.length === 1) {
        if (!(part.length <= 2 && part.every((b) => b === 0))) parts.push(part);
        return;
      }
      const half = Math.ceil(clients.length / 2);
      split(clients.slice(0, half));
      split(clients.slice(half));
    };
    split(missing, whole);
    return parts.length ? parts : [whole];
  }

  /** Whether a peer's state vector has something this document lacks. */
  lacksFrom(sv: Uint8Array): boolean {
    const theirs = Y.decodeStateVector(sv);
    const ours = Y.decodeStateVector(this.stateVector());
    for (const [client, clock] of theirs) if ((ours.get(client) ?? 0) < clock) return true;
    return false;
  }

  /** The shared state as a validated diagram. Cached until something changes; only changed records are re-read. */
  project(): Projection {
    if (this.current && !this.metaDirty && !this.listDirty.size) return this.current;
    for (const kind of this.listDirty) this.lists.set(kind, this.projectList(kind));
    this.listDirty.clear();
    this.metaDirty = false;
    this.stats.projections++;
    const lists = Object.fromEntries(RECORD_KINDS.map((k) => [k, this.lists.get(k) ?? []])) as Record<
      RecordKind,
      Record<string, unknown>[]
    >;
    const { raw, hidden } = assemble(projectMeta(metaOf(this.ydoc)), lists);
    const checked = validateProjection(raw);
    if (checked.ok) {
      this.lastGood = checked.diagram;
      this.current = { status: "ok", diagram: checked.diagram, warnings: checked.warnings, hidden };
    } else this.current = { status: "invalid", error: checked.error, diagram: this.lastGood, hidden };
    return this.current;
  }

  /** Every record as stored, before validation: a recovery export when the state doesn't validate. */
  recoveryExport(): Record<string, unknown> {
    this.project();
    const lists = Object.fromEntries(RECORD_KINDS.map((k) => [k, this.lists.get(k) ?? []])) as Record<
      RecordKind,
      Record<string, unknown>[]
    >;
    const meta = projectMeta(metaOf(this.ydoc));
    return { ...meta, ...lists };
  }

  destroy(): void {
    this.undoManager.destroy();
    this.ydoc.destroy();
    this.listeners.clear();
  }

  private projectList(kind: RecordKind): Record<string, unknown>[] {
    const records = recordsOf(this.ydoc, kind);
    const cache = this.cache.get(kind)!;
    const dirty = this.dirty.get(kind)!;
    for (const id of dirty) {
      const value = records.get(id);
      if (value === undefined) cache.delete(id);
      else {
        cache.set(id, projectRecord(kind, id, value));
        this.stats.recordsProjected++;
      }
    }
    dirty.clear();
    const present = new Set<string>();
    for (const [id, r] of cache) if (r) present.add(id);
    return orderedIds(orderOf(this.ydoc, kind).toArray(), present).map((id) => cache.get(id)!);
  }

  /** Marks what a transaction touched: record ids per list, list orders, meta. */
  private track(tr: Y.Transaction): void {
    this.revision++;
    let touched = false;
    for (const [type, keys] of tr.changed) {
      const loc = locate(type);
      if (!loc) continue;
      touched = true;
      if (loc.root === META) {
        this.metaDirty = true;
        continue;
      }
      const kind = RECORD_KINDS.find((k) => k === loc.root || orderRoot(k) === loc.root);
      if (!kind) continue; // a root outside the schema: never projected
      this.listDirty.add(kind);
      if (loc.root !== kind) continue;
      const dirty = this.dirty.get(kind)!;
      if (loc.id !== undefined) dirty.add(loc.id);
      else for (const k of keys) if (k !== null) dirty.add(k);
    }
    if (touched) for (const fn of this.listeners) fn();
  }
}

/** The root a changed type belongs to, and the record id when it's inside a record. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Yjs types its parents loosely.
function locate(type: Y.AbstractType<any>): { root: string; id?: string } | undefined {
  let t = type;
  let id: string | undefined;
  while (t._item !== null) {
    const item = t._item;
    const parent = item.parent;
    if (!(parent instanceof Y.AbstractType)) return undefined;
    if (parent._item === null) id = item.parentSub ?? undefined;
    t = parent;
  }
  try {
    return { root: Y.findRootTypeKey(t), id };
  } catch {
    return undefined;
  }
}

/** A Yjs (v1) state vector: a count, then client and clock pairs, all unsigned LEB128 varints. */
function encodeStateVector(sv: Map<number, number>): Uint8Array {
  const out: number[] = [];
  const varuint = (n: number) => {
    while (n > 0x7f) {
      out.push(0x80 | (n & 0x7f));
      n = Math.floor(n / 128);
    }
    out.push(n);
  };
  varuint(sv.size);
  for (const [client, clock] of sv) {
    varuint(client);
    varuint(clock);
  }
  return Uint8Array.from(out);
}
