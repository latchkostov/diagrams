import * as Y from "yjs";
import type { DiagramFile } from "../model/types";
import { applyCommands, type DiagramCommand } from "./commands";
import { inspectUpdate, type GuardProblem } from "./guard";
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

export type Projection =
  | { status: "ok"; diagram: DiagramFile; warnings: string[]; hidden: string[] }
  | {
      /** The shared state doesn't validate (see ./schema.ts). `diagram` is the last valid one, if any. */
      status: "invalid";
      error: string;
      diagram: DiagramFile | undefined;
      hidden: string[];
    };

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
}

export interface CollabDocOptions {
  /** Yjs client id (tests pin it so a seeded schedule replays exactly). */
  clientId?: number;
}

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
  }

  /** Called after every change to the shared state (local, remote, undo); read `project()` for the result. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The room creator's initial copy. Only into an empty document. */
  hydrate(diagram: DiagramFile): void {
    if (!this.isEmpty()) throw new Error("A room's document is hydrated once, by its creator.");
    this.ydoc.transact(() => hydrate(this.ydoc, diagram), HYDRATE);
  }

  isEmpty(): boolean {
    return Y.encodeStateVector(this.ydoc).length <= 1;
  }

  /**
   * One editor step, as one transaction and one Undo step. `merge` joins it to the previous step when both carry
   * the same tag (typing a label), the way the editor's own history does; anything else starts a new step.
   */
  apply(commands: readonly DiagramCommand[], opts: { merge?: string } = {}): void {
    if (!commands.length) return;
    if (opts.merge === undefined || opts.merge !== this.lastMerge) this.undoManager.stopCapturing();
    this.lastMerge = opts.merge;
    this.stats.localTransactions++;
    this.ydoc.transact(() => applyCommands(this.ydoc, commands), this.local);
  }

  /** Applies a peer's update after the guard's state-independent checks. */
  applyRemote(update: Uint8Array): { ok: true } | { ok: false; problem: GuardProblem | "apply-failed" } {
    const check = inspectUpdate(update);
    if (!check.ok) {
      this.stats.remoteRefused++;
      return { ok: false, problem: check.problem };
    }
    try {
      Y.applyUpdate(this.ydoc, update, REMOTE);
    } catch {
      this.stats.remoteRefused++;
      return { ok: false, problem: "apply-failed" };
    }
    this.stats.remoteApplied++;
    return { ok: true };
  }

  undo(): boolean {
    this.lastMerge = undefined;
    return this.undoManager.undo() !== null;
  }

  redo(): boolean {
    this.lastMerge = undefined;
    return this.undoManager.redo() !== null;
  }

  canUndo = () => this.undoManager.canUndo();
  canRedo = () => this.undoManager.canRedo();

  stateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /** What a peer with state vector `sv` lacks (everything, without one). */
  encodeDiff(sv?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, sv);
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
