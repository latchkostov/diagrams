import { base64UrlToBytes, bytesToBase64Url } from "../../interop/codec";
import { canCollaborate, type CanvasPrivacyState } from "../../lib/localOnly";
import type { DiagramFile } from "../../model/types";
import { realClock, type Clock } from "../clock";
import type { CollabDoc } from "../doc";
import { CollaborativeEditorRoom } from "../editorRoom";
import { deriveRoomKeys, newRoom, type RoomKeys } from "../keys";
import { consumeRoomFragment, RoomLinkError, type RoomLink, type RoomLinkProblem } from "../link";
import { randomAlias } from "../presence";
import { secureRandom, type RandomBytes } from "../random";
import type { RecoveryStore } from "../recoveryStore";
import { CollabSession, PrivateDiagramError } from "../session";
import type { CollabTransport } from "../transport/types";
import { recordRoom, roomValue, type RoomRole, type TabRoomRecord, type TabRoomStore } from "./tabRoom";

// A room's life in the app (Edit together; collaboration plan E2). React-free, so the lifecycle is tested on the
// in-memory network; src/collab/room/index.ts wires it to the page (tracker transport, Your diagrams, the address
// bar, sessionStorage, page hide and show).
//
// - Starting: only a room this device has just made (newRoom()) seeds the room with the diagram, once. Opening a
//   link, rejoining or reloading never does: a second "creator" can't put an old diagram over everyone's edits.
// - Joining: a link is read from the address (on load and on hashchange) and removed from it at once. Nothing is
//   contacted until the person accepts (`accept`). A joiner has no diagram until a peer sends the room's; then the
//   room becomes a new entry in Your diagrams. The diagram that was open stays as it was.
// - The copy: while the room is open, its diagram is written to its entry in Your diagrams (debounced, and at once
//   when the page hides or the room is left), so leaving, or the room failing, keeps your copy. The encrypted
//   checkpoint (../recovery.ts) keeps the room's CRDT state for a rejoin; the copy is plain, like any diagram.
// - A reload keeps this tab in the room (./tabRoom.ts): it reopens the room from the checkpoint, without asking
//   again. Edits the checkpoint hadn't saved when the page went are kept beside the record as one CRDT update and
//   merged on the way back: a merge only adds those edits, so newer room state saved meanwhile (by a peer, by another
//   tab) is never reverted. The plain copy in Your diagrams is never replayed into the room.
// - Private: a Private diagram never starts or joins a room (checked before anything is contacted), and turning
//   Private on in a room leaves it: the binding refuses the canvas's next step, and Your diagrams' changes (this tab or
//   another) are watched whether or not the room's canvas is showing. The entry is marked Private before the canvas
//   is handed back, so the kept copy stays Private.

export interface RoomLibrary {
  /** A new entry in Your diagrams for a joiner's copy; returns its slug. Throws when storage is full. */
  create(diagram: DiagramFile): string;
  /** Writes the room's diagram as the entry's copy. */
  save(slug: string, diagram: DiagramFile): boolean;
  /** The entry's current copy; undefined once the entry is gone. */
  read(slug: string): DiagramFile | undefined;
  privacy(slug: string): CanvasPrivacyState;
  /** Marks the entry Private (the copy kept after a room left because its content became Private). */
  markPrivate(slug: string): void;
  /** Calls `fn` when Your diagrams change, in this tab or another; returns an unsubscribe. */
  watch(fn: () => void): () => void;
}

export interface RoomDeps {
  transport(keys: RoomKeys): CollabTransport;
  recovery?(): RecoveryStore | undefined;
  tab: TabRoomStore;
  library: RoomLibrary;
  clock?: Clock;
  random?: RandomBytes;
  /** How long edits wait before the copy in Your diagrams is written (the canvas's autosave debounce). */
  mirrorMs?: number;
}

export type RoomNotice = "left" | "private" | "failed" | "storage-full";

export interface OpenRoom {
  role: RoomRole;
  /** Your diagrams' entry for this room; absent while a joiner waits for the room's diagram. */
  slug?: string;
  session: CollabSession;
  editor: CollaborativeEditorRoom;
  /** Changes whenever the canvas must mount a new editor (a new session on the same room). */
  mount: number;
  link: RoomLink;
  /** The session has the room's document (a joiner, or a reload without its checkpoint, waits for a peer's). */
  ready: boolean;
  /**
   * Disconnected, but its copy couldn't be saved (storage full or blocked, or Private that couldn't be recorded). The
   * canvas stays mounted behind a dialog that can't be dismissed, until `retrySave` succeeds or `discardUnsaved`.
   */
  unsaved?: boolean;
}

export type RoomPrompt =
  { kind: "start" } | { kind: "join"; alias: string } | { kind: "invalid"; problem: RoomLinkProblem };

export interface RoomSnapshot {
  open?: OpenRoom;
  /** Opening a room now: as its creator or as a joiner. */
  opening?: RoomRole;
  /** A decision for the person: consent to start or join, or a link that can't be opened. */
  prompt?: RoomPrompt;
  /** The last thing that happened to a room, once (`seq` tells repeats apart). */
  notice?: { kind: RoomNotice; slug?: string; seq: number };
}

interface Active {
  link: RoomLink;
  role: RoomRole;
  session: CollabSession;
  editor: CollaborativeEditorRoom;
  slug?: string;
  alias: string;
  mount: number;
  stops: (() => void)[];
  mirror?: () => void;
  /** Edits not yet in the encrypted checkpoint, as recorded for a reload (base64url CRDT update). */
  pending?: string;
  /** The change count `pending` was computed at: an unchanged document doesn't encode it again. */
  pendingAt?: number;
  /** Document changes seen, and the count the copy in Your diagrams was last written at. */
  changes: number;
  mirrored: number;
  ready: boolean;
  leaving: boolean;
  suspended: boolean;
}

interface OpenRequest {
  link: RoomLink;
  role: RoomRole;
  slug?: string;
  initial?: DiagramFile;
  alias?: string;
  /** Reopening after a reload: merge its unsaved edits. */
  record?: TabRoomRecord;
  /** Reopening after the page came back from the back/forward cache: the same document. */
  doc?: CollabDoc;
}

const sameRoom = (a: RoomLink, b: RoomLink) =>
  a.epoch === b.epoch && a.secret.length === b.secret.length && a.secret.every((x, i) => x === b.secret[i]);

const withoutPrivate = (d: DiagramFile): DiagramFile => {
  if (!("private" in d)) return d;
  const copy = { ...d };
  delete copy.private;
  return copy;
};

export class RoomLifecycle {
  private snap: RoomSnapshot = {};
  private listeners = new Set<() => void>();
  private active?: Active;
  private invite?: RoomLink;
  private attempt = 0;
  private mounts = 0;
  private notices = 0;
  private readonly clock: Clock;
  private readonly random: RandomBytes;
  private navigate?: (slug: string) => void;
  /** A room that disconnected without its copy saved, and what its canvas showed then. */
  private held?: { slug: string; kind: RoomNotice; diagram?: DiagramFile };
  private capture?: (slug: string) => DiagramFile | undefined;

  constructor(private readonly deps: RoomDeps) {
    this.clock = deps.clock ?? realClock;
    this.random = deps.random ?? secureRandom;
  }

  /** The page's ways to show a diagram, and to read the canvas (its state when a room ends). */
  configure(page: { navigate?: (slug: string) => void; capture?: (slug: string) => DiagramFile | undefined }): void {
    this.navigate = page.navigate;
    this.capture = page.capture;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): RoomSnapshot => this.snap;

  private set(next: Partial<RoomSnapshot>): void {
    this.snap = { ...this.snap, ...next };
    for (const fn of this.listeners) fn();
  }

  private openSnapshot(a: Active): OpenRoom {
    return {
      role: a.role,
      slug: a.slug,
      session: a.session,
      editor: a.editor,
      mount: a.mount,
      link: a.link,
      ready: a.ready,
    };
  }

  private notice(kind: RoomNotice, slug?: string): RoomSnapshot["notice"] {
    return { kind, slug, seq: ++this.notices };
  }

  // ---------------------------------------------------------------- asking

  /**
   * Reads a room link from the address and removes it from there at once. Asks before joining; a damaged link says
   * why. The open room's own link (pasted into its tab) changes nothing.
   */
  readAddress(loc?: Parameters<typeof consumeRoomFragment>[0], history?: Parameters<typeof consumeRoomFragment>[1]) {
    let link: RoomLink | undefined;
    try {
      link = consumeRoomFragment(loc, history);
    } catch (error) {
      if (!(error instanceof RoomLinkError)) throw error;
      this.invite = undefined;
      this.set({ prompt: { kind: "invalid", problem: error.problem } });
      return;
    }
    if (!link) return;
    if (this.active && sameRoom(link, this.active.link)) return;
    this.invite = link;
    this.set({ prompt: { kind: "join", alias: randomAlias(() => this.random(1)[0] / 256).alias } });
  }

  /** Edit together… on the open diagram: asks first (the start dialog). */
  requestStart(): void {
    this.invite = undefined;
    this.set({ prompt: { kind: "start" } });
  }

  /** Don't join, Cancel, or closing a link's error: nothing is left behind (a room this tab was in comes back). */
  dismiss(): void {
    this.invite = undefined;
    this.set({ prompt: undefined });
    void this.resume();
  }

  /** A suggested name for the start dialog. */
  suggestAlias(): string {
    return randomAlias(() => this.random(1)[0] / 256).alias;
  }

  // ---------------------------------------------------------------- opening

  /** Join: the person accepted the link's room. */
  async accept(alias?: string): Promise<OpenRoom | undefined> {
    const link = this.invite;
    if (!link) return;
    this.invite = undefined;
    await this.leaveActive("left");
    return this.open({ link, role: "joiner", alias });
  }

  /** Start room: a new room seeded with `diagram`, kept in Your diagrams' entry `slug`. */
  async start(o: { slug: string; diagram: DiagramFile; alias?: string }): Promise<OpenRoom | undefined> {
    this.invite = undefined;
    await this.leaveActive("left");
    return this.open({ link: newRoom(this.random), role: "creator", slug: o.slug, initial: o.diagram, alias: o.alias });
  }

  /** On load: this tab's room before a reload, reopened without asking again. */
  async resume(): Promise<void> {
    // An invitation (or a link's error) in the address comes first: it waits for the person's answer.
    if (this.active || this.snap.opening || (this.snap.prompt && this.snap.prompt.kind !== "start")) return;
    const record = this.deps.tab.read();
    if (!record) return;
    const link = recordRoom(record);
    if (!link) return this.deps.tab.clear();
    const slug = record.slug && this.deps.library.read(record.slug) ? record.slug : undefined;
    await this.open({ link, role: record.role, slug, alias: record.alias, record });
  }

  private async open(o: OpenRequest): Promise<OpenRoom | undefined> {
    const token = ++this.attempt;
    this.set({ opening: o.role, prompt: undefined });
    const privacy: CanvasPrivacyState = o.slug
      ? { ...this.deps.library.privacy(o.slug), diagram: o.initial ?? this.deps.library.read(o.slug) }
      : {};
    let transport: CollabTransport | undefined;
    let session: CollabSession | undefined;
    // The entry's flags as they are now: another tab may mark it Private while the keys and recovery load.
    const allowed = () => !o.slug || canCollaborate(this.deps.library.privacy(o.slug));
    try {
      // Before anything is contacted: a Private diagram never reaches a tracker.
      if (!canCollaborate(privacy) || privacy.diagram?.private) throw new PrivateDiagramError();
      const keys = await deriveRoomKeys(o.link);
      if (token !== this.attempt) return;
      if (!allowed()) throw new PrivateDiagramError();
      transport = this.deps.transport(keys);
      session = await CollabSession.open({
        room: o.link,
        transport,
        privacy,
        allowed,
        initial: o.initial && withoutPrivate(o.initial),
        doc: o.doc,
        recovery: this.deps.recovery?.(),
        clock: this.deps.clock,
        random: this.deps.random,
        presence: o.alias ? { alias: o.alias } : undefined,
      });
    } catch (error) {
      transport?.close();
      if (token === this.attempt) {
        if (o.record) this.deps.tab.clear();
        this.set({
          opening: undefined,
          notice: this.notice(error instanceof PrivateDiagramError ? "private" : "failed", o.slug),
        });
      }
      return;
    }
    if (token !== this.attempt) {
      await session.leave();
      return;
    }
    const privacyOf = () => (a.slug ? this.deps.library.privacy(a.slug) : {});
    const a: Active = {
      link: o.link,
      role: o.role,
      session,
      editor: new CollaborativeEditorRoom(session, () => privacyOf()),
      slug: o.slug,
      alias: session.me.alias,
      mount: ++this.mounts,
      stops: [],
      // A reload's unsaved edits stay recorded until a checkpoint that includes them is saved.
      pending: o.record?.pending,
      // What the session holds now (a checkpoint restored, a reload's edits merged, a seed) counts as unwritten:
      // the copy is current only once a save of it succeeds.
      changes: 1,
      mirrored: 0,
      ready: session.hasDocument,
      leaving: false,
      suspended: false,
    };
    this.active = a;
    if (o.record?.pending) this.mergePending(a, o.record.pending);
    a.stops.push(session.onChange(() => this.changed(a)));
    a.stops.push(
      session.doc.onChange(() => {
        a.changes++;
        this.scheduleMirror(a);
      }),
    );
    // Privacy is enforced here too, so it holds while the room's canvas isn't showing (or another tab changes it).
    a.stops.push(this.deps.library.watch(() => this.checkPrivacy(a)));
    this.checkPrivacy(a);
    if (this.active !== a) return;
    this.record(a);
    if (a.ready) this.scheduleMirror(a);
    this.changed(a);
    if (this.active !== a) return;
    const open = this.openSnapshot(a);
    this.set({ opening: undefined, open });
    // A reload or the back/forward cache reopens where the page already is; starting shows the room's diagram.
    if (a.slug && !o.record && !o.doc) this.navigate?.(a.slug);
    return open;
  }

  /** Edits from before a reload that the checkpoint hadn't saved: merged, never replayed as a snapshot. */
  private mergePending(a: Active, pending: string): void {
    let update: Uint8Array;
    try {
      update = base64UrlToBytes(pending);
    } catch {
      return;
    }
    a.session.doc.applyCheckpoint(update);
    a.ready = a.session.hasDocument;
  }

  /**
   * On every change to Your diagrams: the entry's own privacy flags only (one small record), never the whole
   * diagram. Content that makes a diagram Private (a paste) is the binding's to refuse, at the canvas.
   */
  private checkPrivacy(a: Active): void {
    if (this.active !== a || a.leaving || !a.slug) return;
    if (!canCollaborate(this.deps.library.privacy(a.slug))) void this.finish(a, "private");
  }

  private record(a: Active): void {
    this.deps.tab.write({
      room: roomValue(a.link),
      role: a.role,
      alias: a.alias,
      ...(a.slug ? { slug: a.slug } : {}),
      ...(a.pending ? { pending: a.pending } : {}),
    });
  }

  private changed(a: Active): void {
    // A room on its way out (the page going, Leave, the cache) records nothing more.
    if (this.active !== a || a.leaving) return;
    if (a.session.status === "left") {
      void this.finish(a, a.editor.refusal === "private" ? "private" : "left");
      return;
    }
    if (a.pending && a.session.recovery?.saved) {
      a.pending = undefined;
      this.record(a);
    }
    if (a.ready !== a.session.hasDocument) {
      a.ready = a.session.hasDocument;
      if (a.slug && this.snap.open) this.set({ open: this.openSnapshot(a) });
    }
    if (a.slug || !a.session.hasDocument) return;
    const projected = a.session.doc.project();
    if (projected.status !== "ok" || !projected.diagram) return;
    try {
      a.slug = this.deps.library.create(withoutPrivate(projected.diagram));
    } catch {
      this.set({ notice: this.notice("storage-full") });
      return;
    }
    this.record(a);
    if (this.snap.open) this.set({ open: this.openSnapshot(a) });
    this.navigate?.(a.slug);
  }

  // ---------------------------------------------------------------- the copy in Your diagrams

  private scheduleMirror(a: Active): void {
    if (!a.slug || a.leaving) return;
    a.mirror?.();
    a.mirror = this.clock.after(this.deps.mirrorMs ?? 300, () => {
      a.mirror = undefined;
      this.flushMirror(a);
    });
  }

  /** Writes the copy; false only when there was something to keep and storage refused it. */
  private flushMirror(a: Active, diagram?: DiagramFile): boolean {
    a.mirror?.();
    a.mirror = undefined;
    this.notePending(a);
    // Nothing changed since the copy was last written: no second serialization of the whole diagram.
    if (!a.slug || (!diagram && a.mirrored === a.changes)) return true;
    const projected = a.session.doc.project();
    const d = diagram ?? (projected.status === "ok" ? projected.diagram : undefined);
    if (!d) return true;
    if (!this.deps.library.save(a.slug, withoutPrivate(d))) return false;
    a.mirrored = a.changes;
    return true;
  }

  /** Records, for a reload, what the checkpoint hasn't saved yet (a CRDT update: merging it reverts nothing). */
  private notePending(a: Active): void {
    if (a.leaving) return;
    // Unchanged since it was encoded (and not yet saved): the recorded update still covers everything.
    if (a.pending && a.pendingAt === a.changes && !a.session.recovery?.saved) return;
    a.pendingAt = a.changes;
    const unsaved = a.session.recovery?.unsaved(a.session.doc);
    const pending = unsaved && bytesToBase64Url(unsaved);
    if (pending === a.pending) return;
    a.pending = pending;
    this.record(a);
  }

  /** The page is hiding or going (the canvas's autosave moments): the copy is written now. */
  flush(): void {
    if (this.active && !this.active.leaving) this.flushMirror(this.active);
  }

  // ---------------------------------------------------------------- leaving

  /** Leave room: only this person disconnects. The copy stays in Your diagrams. */
  async leave(): Promise<void> {
    this.attempt++;
    // Leaving while the room still opens (a reload's rejoin, a join waiting for its keys) forgets it too.
    this.deps.tab.clear();
    if (this.snap.opening) this.set({ opening: undefined });
    await this.leaveActive("left");
  }

  private async leaveActive(kind: RoomNotice): Promise<void> {
    const a = this.active;
    if (a) await this.finish(a, kind);
  }

  private async finish(a: Active, kind: RoomNotice): Promise<void> {
    if (a.leaving && !a.suspended) return;
    a.leaving = true;
    // The room's canvas as it is now (with a Private paste that only the canvas knew).
    const diagram = a.slug ? (this.capture?.(a.slug) ?? a.session.doc.project().diagram) : undefined;
    let kept = false;
    try {
      kept = !a.slug || (kind === "private" ? this.keep(a.slug, diagram, true) : this.flushMirror(a));
    } catch {
      // Not kept: the dialog below.
    }
    try {
      for (const stop of a.stops) stop();
      a.stops = [];
      if (this.active === a) {
        this.active = undefined;
        this.deps.tab.clear();
        if (!kept && a.slug) {
          // Disconnected all the same; the canvas stays behind a dialog until the copy saves or is discarded.
          this.held = { slug: a.slug, kind, diagram };
          this.set({ open: { ...this.openSnapshot(a), unsaved: true } });
        } else this.set({ open: undefined, notice: this.notice(kind, a.slug) });
      }
    } finally {
      await a.session.leave();
    }
  }

  /**
   * Writes the copy. Private first, read again each time (the cause of leaving, the canvas's own flag, the entry's):
   * the entry is marked Private before its content is written, and nothing is written if that can't be recorded.
   */
  private keep(slug: string, diagram: DiagramFile | undefined, isPrivate: boolean): boolean {
    if (isPrivate || diagram?.private || this.deps.library.privacy(slug).private) {
      try {
        this.deps.library.markPrivate(slug);
      } catch {
        return false;
      }
    }
    return !diagram || this.deps.library.save(slug, withoutPrivate(diagram));
  }

  /** The copy that couldn't be saved: what its canvas showed (Save a file copy exports this). */
  unsavedDiagram(): DiagramFile | undefined {
    return this.held?.diagram;
  }

  /** Try again: the same save; true once it succeeds (the canvas then reloads from the copy). */
  retrySave(): boolean {
    const held = this.held;
    if (!held) return false;
    let saved = false;
    try {
      saved = this.keep(held.slug, held.diagram, held.kind === "private");
    } catch {
      // Still not saved.
    }
    if (saved && this.held === held) {
      this.held = undefined;
      this.set({ open: undefined, notice: this.notice(held.kind, held.slug) });
    }
    return saved;
  }

  /** Discard changes: the canvas goes back to the stored copy. */
  discardUnsaved(): void {
    if (!this.held) return;
    this.held = undefined;
    this.set({ open: undefined });
  }

  /** Retry after "Could not connect": the room and its edits stay. */
  retry(): void {
    this.active?.session.retryConnection();
  }

  // ---------------------------------------------------------------- the page

  /** The page is going (reload, close): the copy now, then goodbye. This tab's record stays: a reload rejoins. */
  pageHidden(): void {
    const a = this.active;
    if (!a || a.leaving) return;
    this.flushMirror(a);
    a.leaving = true;
    void a.session.leave();
    a.session.transport.close();
  }

  /** Into the back/forward cache: leave for now, keeping the document. */
  suspend(): void {
    const a = this.active;
    if (!a || a.leaving) return;
    this.flushMirror(a);
    a.leaving = a.suspended = true;
    for (const stop of a.stops) stop();
    a.stops = [];
    void a.session.leave();
    // At once: a page with open connections can't be kept in the cache.
    a.session.transport.close();
  }

  /** Back from the back/forward cache: the same document rejoins (a new session, so a new editor mount). */
  async restore(): Promise<void> {
    const a = this.active;
    if (!a?.suspended) return;
    await a.session.leave();
    if (this.active !== a) return;
    this.active = undefined;
    await this.open({ link: a.link, role: a.role, slug: a.slug, alias: a.alias, doc: a.session.doc });
  }

  /** Clear everything on this device: stop at once, saving nothing more (every store refuses by then anyway). */
  wipe(): void {
    this.attempt++;
    this.invite = undefined;
    const a = this.active;
    this.active = undefined;
    if (a) {
      a.mirror?.();
      a.mirror = undefined;
      a.leaving = true;
      for (const stop of a.stops) stop();
      a.stops = [];
      void a.session.leave();
      a.session.transport.close();
    }
    this.deps.tab.clear();
  }
}
