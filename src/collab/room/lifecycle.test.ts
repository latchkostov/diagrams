import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CanvasPrivacyState } from "../../lib/localOnly";
import type { DiagramFile } from "../../model/types";
import { FakeClock } from "../clock";
import { commandsFromDiff } from "../commands";
import { formatRoomLink } from "../link";
import { seededBytes } from "../random";
import {
  evictions,
  recoverySummary,
  type RecoveryChunk,
  type RecoveryRecord,
  type RecoveryStore,
} from "../recoveryStore";
import { canaryDiagram } from "../transport/conformance";
import { MemoryNetwork } from "../transport/memory";
import type { CollabTransport } from "../transport/types";
import { RoomLifecycle, type RoomLibrary } from "./lifecycle";
import { memoryTabRoom } from "./tabRoom";
import { serializeNative } from "../../interop/native";

// The room lifecycle (Edit together, plan E2) on the in-memory network: who seeds the room, what a link may do
// before consent, the copy in Your diagrams, and a reload.

/** One browser's encrypted recovery store (the IndexedDB one's semantics, in memory). */
class Store implements RecoveryStore {
  records = new Map<string, RecoveryRecord>();
  /** Writes wait here while set: a checkpoint still being saved. */
  hold?: Promise<void>;
  /** Reads of the head wait here while set: recovery still loading. */
  headHold?: Promise<void>;
  async head(id: string) {
    await this.headHold;
    const r = this.records.get(id);
    return Promise.resolve(r && recoverySummary(r));
  }
  tail(id: string, checkpoint: string, after: number) {
    const old = this.records.get(id);
    if (!old || (old.checkpoint ?? old.token) !== checkpoint) return Promise.resolve(undefined);
    return Promise.resolve({ head: recoverySummary(old), updates: structuredClone(old.updates?.slice(after) ?? []) });
  }
  append(id: string, expected: string, token: string, touched: number, update: RecoveryChunk) {
    const old = this.records.get(id);
    if (old?.token !== expected) return Promise.resolve(false);
    return this.write(
      { ...old, token, touched, checkpoint: old.checkpoint ?? old.token, updates: [...(old.updates ?? []), update] },
      expected,
    );
  }
  read(id: string) {
    return Promise.resolve(structuredClone(this.records.get(id)));
  }
  async write(record: RecoveryRecord, expected?: string) {
    await this.hold;
    if (this.records.get(record.id)?.token !== expected) return false;
    this.records.set(record.id, structuredClone(record));
    for (const id of evictions([...this.records.values()].map(recoverySummary), record.id, record.touched))
      this.records.delete(id);
    return true;
  }
  remove(id: string, expected: string) {
    if (this.records.get(id)?.token === expected) this.records.delete(id);
    return Promise.resolve();
  }
}

/** One browser's Your diagrams. */
class Library implements RoomLibrary {
  entries = new Map<string, DiagramFile>();
  flags = new Map<string, CanvasPrivacyState>();
  private next = 0;
  create(d: DiagramFile) {
    const slug = `my-room${++this.next}`;
    this.entries.set(slug, structuredClone(d));
    return slug;
  }
  save(slug: string, d: DiagramFile) {
    if (!this.entries.has(slug)) return false;
    this.entries.set(slug, structuredClone(d));
    return true;
  }
  read(slug: string) {
    return this.entries.get(slug);
  }
  privacy(slug: string) {
    return this.flags.get(slug) ?? {};
  }
  markPrivate(slug: string) {
    this.flags.set(slug, { ...this.privacy(slug), private: true });
    this.changed();
  }
  private watchers = new Set<() => void>();
  watch(fn: () => void) {
    this.watchers.add(fn);
    return () => void this.watchers.delete(fn);
  }
  /** Your diagrams changed (here, or in another tab of this browser). */
  changed() {
    for (const fn of [...this.watchers]) fn();
  }
}

interface Browser {
  room: RoomLifecycle;
  library: Library;
  store: Store;
  tab: ReturnType<typeof memoryTabRoom>;
  transports: CollabTransport[];
  shown: string[];
}

function browser(
  net: MemoryNetwork,
  clock: FakeClock,
  seed: number,
  from?: Partial<Pick<Browser, "library" | "store" | "tab">>,
): Browser {
  const b: Browser = {
    library: from?.library ?? new Library(),
    store: from?.store ?? new Store(),
    tab: from?.tab ?? memoryTabRoom(),
    transports: [],
    shown: [],
    room: undefined as unknown as RoomLifecycle,
  };
  b.room = new RoomLifecycle({
    transport: () => {
      const t = net.connect();
      b.transports.push(t);
      return t;
    },
    recovery: () => b.store,
    tab: b.tab,
    library: b.library,
    clock,
    random: seededBytes(seed),
  });
  b.room.configure({ navigate: (slug) => b.shown.push(slug) });
  onTestFinished(() => b.room.wipe());
  return b;
}

/** Another tab of `b`'s browser: the same recovery records (its own write hold), its own tab and Your diagrams. */
function sibling(net: MemoryNetwork, clock: FakeClock, seed: number, b: Browser): Browser {
  const store = new Store();
  store.records = b.store.records;
  return browser(net, clock, seed, { store, library: new Library() });
}

const linkOf = (b: Browser) => formatRoomLink("https://livediagrams.test/", b.room.getSnapshot().open!.link);

/** Opens `link` in `b` as a person would: the address, the consent prompt, Join. */
async function join(b: Browser, link: string) {
  const url = new URL(link);
  b.room.readAddress({ hash: url.hash, pathname: url.pathname, search: url.search }, nohistory);
  expect(b.room.getSnapshot().prompt?.kind).toBe("join");
  await b.room.accept();
}
const nohistory = { state: null, replaceState() {} };

const session = (b: Browser) => b.room.getSnapshot().open!.session;
const titleOf = (b: Browser) => session(b).doc.project().diagram?.title;

/** A local edit, as the canvas commits one. */
function edit(b: Browser, change: (d: DiagramFile) => DiagramFile) {
  const doc = session(b).doc;
  const before = doc.project().diagram!;
  expect(doc.apply(commandsFromDiff(before, change(structuredClone(before)))).ok).toBe(true);
}

async function settle(net: MemoryNetwork, ...bs: Browser[]) {
  await net.settle(async () => {
    for (const b of bs) {
      const s = b.room.getSnapshot().open?.session;
      await s?.idle();
      await s?.recovery?.flush(s.doc);
    }
  });
}

async function start(b: Browser, diagram = canaryDiagram()) {
  const slug = b.library.create(diagram);
  await b.room.start({ slug, diagram });
  return slug;
}

describe("starting and joining", () => {
  it("seeds a new room once from the creator's diagram; the joiner gets a new entry and its own copy", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 1),
      b = browser(net, clock, 2);
    const slug = await start(a);
    expect(titleOf(a)).toBe(canaryDiagram().title);
    expect(a.shown).toEqual([slug]);
    expect(a.tab.read()).toMatchObject({ role: "creator", slug });

    const bOwn = b.library.create({ ...canaryDiagram(), title: "B's own diagram" });
    await join(b, linkOf(a));
    // No document until a peer answers: no entry, nothing shown, the person's own diagram untouched.
    expect(b.room.getSnapshot().open?.slug).toBeUndefined();
    await settle(net, a, b);
    const bRoom = b.room.getSnapshot().open!.slug!;
    expect(bRoom).not.toBe(bOwn);
    expect(b.shown).toEqual([bRoom]);
    expect(b.library.read(bRoom)?.title).toBe(canaryDiagram().title);
    expect(b.library.read(bOwn)?.title).toBe("B's own diagram");
    expect(b.tab.read()).toMatchObject({ role: "joiner", slug: bRoom });

    edit(b, (d) => ({ ...d, title: "Renamed by B" }));
    await settle(net, a, b);
    expect(titleOf(a)).toBe("Renamed by B");
    clock.advance(300);
    expect(a.library.read(slug)?.title).toBe("Renamed by B");
    expect(b.library.read(bRoom)?.title).toBe("Renamed by B");
  });

  it("contacts nothing until Join, and Don't join leaves nothing behind", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 3),
      b = browser(net, clock, 4);
    await start(a);
    const url = new URL(linkOf(a));
    let scrubbed = "";
    b.room.readAddress(
      { hash: url.hash, pathname: "/", search: "" },
      { state: null, replaceState: (_s, _u, to) => void (scrubbed = to) },
    );
    expect(scrubbed).toBe("/");
    expect(b.room.getSnapshot().prompt?.kind).toBe("join");
    expect(b.transports).toHaveLength(0);
    b.room.dismiss();
    expect(b.room.getSnapshot().prompt).toBeUndefined();
    await b.room.accept();
    expect(b.transports).toHaveLength(0);
    expect(b.tab.read()).toBeUndefined();
    expect(b.library.entries.size).toBe(0);
  });

  it("a link never seeds the room: alone, a joiner waits with no document and no entry", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 5),
      b = browser(net, clock, 6);
    await start(a);
    const link = linkOf(a);
    await a.room.leave();
    await join(b, link);
    await settle(net, b);
    expect(session(b).hasDocument).toBe(false);
    expect(b.library.entries.size).toBe(0);
  });

  it("a damaged link says why and opens nothing", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const b = browser(net, clock, 7);
    b.room.readAddress({ hash: "#room=v1.0.short", pathname: "/", search: "" }, nohistory);
    expect(b.room.getSnapshot().prompt).toEqual({ kind: "invalid", problem: "damaged" });
    await b.room.accept();
    expect(b.transports).toHaveLength(0);
  });

  it("refuses a Private diagram before contacting anything", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 8);
    const slug = a.library.create(canaryDiagram());
    a.library.flags.set(slug, { private: true });
    await a.room.start({ slug, diagram: canaryDiagram() });
    expect(a.transports).toHaveLength(0);
    expect(a.room.getSnapshot().open).toBeUndefined();
    expect(a.room.getSnapshot().notice).toMatchObject({ kind: "private", slug });
    expect(a.tab.read()).toBeUndefined();
  });
});

describe("leaving and reloading", () => {
  it("a second 'creator' rejoining an existing room can't put its old diagram back", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 9),
      b = browser(net, clock, 10);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    edit(b, (d) => ({ ...d, title: "B's newer title" }));
    await settle(net, a, b);
    // A reloads with its recovery gone (cleared site data): its tab still says "creator", with the old copy.
    a.room.pageHidden();
    a.store.records.clear();
    const old = a.library.read(a.tab.read()!.slug!)!;
    a.library.save(a.tab.read()!.slug!, { ...old, title: "The creator's old title" });
    const reloaded = browser(net, clock, 11, a);
    await reloaded.room.resume();
    expect(session(reloaded).hasDocument).toBe(false);
    await settle(net, reloaded, b);
    expect(titleOf(reloaded)).toBe("B's newer title");
    expect(titleOf(b)).toBe("B's newer title");
  });

  it("a reload rejoins the same room from the checkpoint, without asking again", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 12),
      b = browser(net, clock, 13);
    const slug = await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    const bSlug = b.room.getSnapshot().open!.slug!;
    edit(b, (d) => ({ ...d, title: "Before B's reload" }));
    await settle(net, a, b);
    b.room.pageHidden();
    await settle(net, a);
    const reloaded = browser(net, clock, 14, b);
    await reloaded.room.resume();
    expect(reloaded.room.getSnapshot().prompt).toBeUndefined();
    expect(reloaded.room.getSnapshot().open?.slug).toBe(bSlug);
    // The page reopens where it was (its address); nothing navigates.
    expect(reloaded.shown).toEqual([]);
    expect(titleOf(reloaded)).toBe("Before B's reload");
    edit(reloaded, (d) => ({ ...d, title: "After B's reload" }));
    await settle(net, a, reloaded);
    expect(titleOf(a)).toBe("After B's reload");
    clock.advance(300);
    expect(a.library.read(slug)?.title).toBe("After B's reload");
    // Only one entry for the room: the reload reused it.
    expect(reloaded.library.entries.size).toBe(1);
  });

  it("an edit the checkpoint hadn't saved before a reload is merged back in", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 15),
      b = browser(net, clock, 16);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    let release = () => {};
    a.store.hold = new Promise((resolve) => (release = resolve));
    // The peer doesn't hear it either (it goes out with the page): only this tab has it.
    net.partition([[...a.transports.map((t) => t.self)], [...b.transports.map((t) => t.self)]]);
    edit(a, (d) => ({ ...d, title: "Typed just before reload" }));
    a.room.pageHidden();
    expect(a.tab.read()?.pending).toBeDefined();
    // The page went before its checkpoint write finished.
    const reloaded = browser(net, clock, 17, { ...a, store: new Store() });
    reloaded.store.records = new Map(a.store.records);
    net.heal();
    await reloaded.room.resume();
    expect(titleOf(reloaded)).toBe("Typed just before reload");
    await settle(net, reloaded, b);
    expect(titleOf(b)).toBe("Typed just before reload");
    release();
  });

  it("reload preserves newer checkpoint state when pending edits outlive their write", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 30);
    await start(a);
    const link = linkOf(a);
    let release = () => {};
    a.store.hold = new Promise((resolve) => (release = resolve));
    edit(a, (d) => ({ ...d, title: "A, pending at the reload" }));
    a.room.pageHidden();
    expect(a.tab.read()?.pending).toBeDefined();
    // The held write completes after the page went...
    release();
    await a.room.getSnapshot().open!.session.leave();
    // ...and another tab of this browser saves newer room state over it.
    const other = sibling(net, clock, 31, a);
    await join(other, link);
    expect(titleOf(other)).toBe("A, pending at the reload");
    edit(other, (d) => ({ ...d, title: "Newer, from another tab" }));
    await settle(net, other);
    await other.room.leave();
    const reloaded = browser(net, clock, 32, a);
    await reloaded.room.resume();
    expect(titleOf(reloaded)).toBe("Newer, from another tab");
  });

  it("A's pending title and B's saved description both survive A's reload, on both peers", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 33);
    await start(a);
    const b = sibling(net, clock, 34, a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    net.partition([[...a.transports.map((t) => t.self)], [...b.transports.map((t) => t.self)]]);
    a.store.hold = new Promise(() => {});
    edit(a, (d) => ({ ...d, title: "A's pending title" }));
    a.room.pageHidden();
    edit(b, (d) => ({ ...d, description: "B's saved description" }));
    await settle(net, b);
    const store = new Store();
    store.records = a.store.records;
    const reloaded = browser(net, clock, 35, { ...a, store });
    net.heal();
    await reloaded.room.resume();
    await settle(net, reloaded, b);
    for (const peer of [reloaded, b]) {
      expect(titleOf(peer)).toBe("A's pending title");
      expect(session(peer).doc.project().diagram?.description).toBe("B's saved description");
    }
  });

  it("an older copy than the checkpoint is never replayed over newer room state", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 18);
    const slug = await start(a);
    edit(a, (d) => ({ ...d, title: "Saved in the checkpoint" }));
    await settle(net, a);
    // The page was killed before the debounced copy was written: the copy is the older one.
    expect(a.library.read(slug)?.title).toBe(canaryDiagram().title);
    expect(a.tab.read()?.pending).toBeUndefined();
    const reloaded = browser(net, clock, 19, a);
    await reloaded.room.resume();
    expect(titleOf(reloaded)).toBe("Saved in the checkpoint");
  });

  it("Leave keeps the copy in Your diagrams, forgets the tab's room and tells the peer", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 20),
      b = browser(net, clock, 21);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    edit(b, (d) => ({ ...d, title: "Kept after leaving" }));
    await settle(net, a, b);
    const bSlug = b.room.getSnapshot().open!.slug!;
    await b.room.leave();
    expect(b.room.getSnapshot().open).toBeUndefined();
    expect(b.room.getSnapshot().notice).toMatchObject({ kind: "left", slug: bSlug });
    expect(b.library.read(bSlug)?.title).toBe("Kept after leaving");
    expect(b.tab.read()).toBeUndefined();
    await settle(net, a);
    expect(session(a).transport.peers()).toHaveLength(0);
    // A later load has no room to resume.
    const later = browser(net, clock, 22, b);
    await later.room.resume();
    expect(later.room.getSnapshot().open).toBeUndefined();
    expect(later.transports).toHaveLength(0);
  });

  it("Leave while a reload's rejoin is still opening forgets the room too", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 28);
    await start(a);
    a.room.pageHidden();
    const reloaded = browser(net, clock, 29, a);
    const resuming = reloaded.room.resume();
    expect(reloaded.room.getSnapshot().opening).toBe("creator");
    await reloaded.room.leave();
    await resuming;
    expect(reloaded.room.getSnapshot().open).toBeUndefined();
    expect(reloaded.tab.read()).toBeUndefined();
  });

  it("content pasted from a Private diagram leaves the room and keeps the copy Private", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 36);
    const slug = await start(a);
    const open = a.room.getSnapshot().open!;
    const pasted = { ...canaryDiagram(), title: "With a Private paste", private: true };
    // Only the canvas knew (its transient room flag): the binding refused the step and left the room.
    a.room.configure({ capture: (s) => (s === slug ? pasted : undefined) });
    open.editor.refusal = "private";
    await open.session.leave();
    expect(a.room.getSnapshot().open).toBeUndefined();
    expect(a.room.getSnapshot().notice).toMatchObject({ kind: "private", slug });
    expect(a.library.privacy(slug).private).toBe(true);
    expect(a.library.read(slug)?.title).toBe("With a Private paste");
    expect(a.library.read(slug)?.private).toBeUndefined();
  });

  it("marking the room's diagram Private elsewhere leaves the room, with its canvas showing or not", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 37),
      b = browser(net, clock, 38);
    const slug = await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    const session = a.room.getSnapshot().open!.session;
    // Another tab turns Private on: its storage event reaches this tab as a change to Your diagrams.
    a.library.flags.set(slug, { private: true });
    a.library.changed();
    expect(a.room.getSnapshot().open).toBeUndefined();
    expect(a.room.getSnapshot().notice).toMatchObject({ kind: "private", slug });
    expect(a.tab.read()).toBeUndefined();
    await session.idle();
    await settle(net, b);
    expect(session.status).toBe("left");
    expect(b.room.getSnapshot().open!.session.transport.peers()).toHaveLength(0);
  });

  it("an invitation in the address waits for an answer before this tab's earlier room resumes", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 39),
      other = browser(net, clock, 40);
    await start(a);
    await start(other);
    const invitation = new URL(linkOf(other));
    a.room.pageHidden();
    const reloaded = browser(net, clock, 41, a);
    reloaded.room.readAddress({ hash: invitation.hash, pathname: "/", search: "" }, nohistory);
    await reloaded.room.resume();
    expect(reloaded.room.getSnapshot().prompt?.kind).toBe("join");
    expect(reloaded.transports).toHaveLength(0);
    // Don't join: the earlier room comes back.
    reloaded.room.dismiss();
    await expect.poll(() => reloaded.room.getSnapshot().open?.role).toBe("creator");
  });

  it("leaving after checkpoint recovery keeps the recovered copy", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 43);
    const slug = await start(a);
    edit(a, (d) => ({ ...d, title: "Saved before the page died" }));
    await settle(net, a);
    // The page died before the debounced copy: no pagehide, so the copy is the older one.
    expect(a.library.read(slug)?.title).toBe(canaryDiagram().title);
    const reloaded = browser(net, clock, 44, a);
    await reloaded.room.resume();
    await reloaded.room.leave();
    expect(reloaded.library.read(slug)?.title).toBe("Saved before the page died");
  });

  it("leaving after resuming a checkpoint another tab advanced keeps that newer copy", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 45);
    const slug = await start(a);
    const link = linkOf(a);
    a.room.pageHidden();
    await a.room.getSnapshot().open!.session.leave();
    const other = sibling(net, clock, 46, a);
    await join(other, link);
    edit(other, (d) => ({ ...d, title: "Advanced by another tab" }));
    await settle(net, other);
    await other.room.leave();
    const reloaded = browser(net, clock, 47, a);
    await reloaded.room.resume();
    await reloaded.room.leave();
    expect(reloaded.library.read(slug)?.title).toBe("Advanced by another tab");
  });

  it("pending deletion survives reload alongside a peer edit", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 48);
    await start(a);
    const b = sibling(net, clock, 49, a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    net.partition([[...a.transports.map((t) => t.self)], [...b.transports.map((t) => t.self)]]);
    a.store.hold = new Promise(() => {});
    edit(a, (d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== "ledger"), edges: [] }));
    a.room.pageHidden();
    edit(b, (d) => ({ ...d, title: "B's saved title" }));
    await settle(net, b);
    const reopen = async (from: Browser, seed: number) => {
      const store = new Store();
      store.records = a.store.records;
      const r = browser(net, clock, seed, { ...from, store });
      await r.room.resume();
      return r;
    };
    net.heal();
    const reloaded = await reopen(a, 50);
    await settle(net, reloaded, b);
    const check = async (peers: Browser[]) => {
      for (const peer of peers) {
        const d = session(peer).doc.project().diagram!;
        expect(d.title).toBe("B's saved title");
        expect(d.nodes.map((n) => n.id)).toEqual(["intake"]);
        expect(d.edges).toEqual([]);
      }
      const proofs = await Promise.all(peers.map((p) => session(p).doc.syncProof()));
      expect(proofs[0]).toEqual(proofs[1]);
    };
    await check([reloaded, b]);
    // Once more, from the checkpoint the merge itself saved.
    reloaded.room.pageHidden();
    const again = await reopen(reloaded, 51);
    await settle(net, again, b);
    await check([again, b]);
  });

  it("a refused save disconnects but holds the room's canvas until Try again saves it or Discard drops it", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 55),
      b = browser(net, clock, 56);
    const slug = await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    const save = a.library.save.bind(a.library);
    a.library.save = () => false;
    edit(a, (d) => ({ ...d, title: "Not saved yet" }));
    const open = a.room.getSnapshot().open!;
    await a.room.leave();
    expect(open.session.status).toBe("left");
    await settle(net, b);
    expect(session(b).transport.peers()).toHaveLength(0);
    // The same canvas mount stays (behind the dialog); its document is what Save a file copy exports.
    expect(a.room.getSnapshot().open).toMatchObject({ unsaved: true, slug, mount: open.mount });
    expect(a.room.unsavedDiagram()?.title).toBe("Not saved yet");
    expect(a.tab.read()).toBeUndefined();
    expect(a.room.retrySave()).toBe(false);
    a.library.save = save;
    expect(a.room.retrySave()).toBe(true);
    expect(a.room.getSnapshot().open).toBeUndefined();
    expect(a.library.read(slug)?.title).toBe("Not saved yet");
    // Discard changes: the stored copy stays as it was.
    await a.room.start({ slug, diagram: a.library.read(slug)! });
    a.library.save = () => false;
    edit(a, (d) => ({ ...d, title: "Discarded" }));
    await a.room.leave();
    expect(a.room.getSnapshot().open?.unsaved).toBe(true);
    a.room.discardUnsaved();
    expect(a.room.getSnapshot().open).toBeUndefined();
    expect(a.library.read(slug)?.title).toBe("Not saved yet");
  });

  it("a Private paste whose Private mark fails writes nothing public, and Try again saves it Private", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 52);
    const slug = await start(a);
    const markPrivate = a.library.markPrivate.bind(a.library);
    a.library.markPrivate = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    const pasted = { ...canaryDiagram(), title: "Private paste", private: true };
    a.room.configure({ capture: (s) => (s === slug ? pasted : undefined) });
    const open = a.room.getSnapshot().open!;
    open.editor.refusal = "private";
    await open.session.leave();
    expect(a.room.getSnapshot().open).toMatchObject({ unsaved: true, slug });
    expect(a.library.read(slug)?.title).toBe(canaryDiagram().title);
    expect(a.library.privacy(slug).private).toBeUndefined();
    expect(a.room.unsavedDiagram()?.private).toBe(true);
    // Still failing: still nothing written.
    expect(a.room.retrySave()).toBe(false);
    expect(a.library.read(slug)?.title).toBe(canaryDiagram().title);
    a.library.markPrivate = markPrivate;
    expect(a.room.retrySave()).toBe(true);
    expect(a.library.privacy(slug).private).toBe(true);
    expect(a.library.read(slug)?.title).toBe("Private paste");
    // The watcher's way: another tab set Private and recording it here fails; the room disconnects all the same.
    const c = browser(net, clock, 54);
    const cSlug = await start(c);
    c.library.markPrivate = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    const cSession = c.room.getSnapshot().open!.session;
    c.library.flags.set(cSlug, { private: true });
    c.library.changed();
    await cSession.idle();
    expect(cSession.status).toBe("left");
    expect(c.room.getSnapshot().open?.unsaved).toBe(true);
  });

  it("a Private exit's save isn't overwritten by a copy still pending from before it", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 65);
    const slug = await start(a);
    edit(a, (d) => ({ ...d, title: "Room edit, its copy pending" }));
    const pasted = { ...canaryDiagram(), title: "Private paste", private: true };
    a.room.configure({ capture: (s) => (s === slug ? pasted : undefined) });
    const open = a.room.getSnapshot().open!;
    open.editor.refusal = "private";
    await open.session.leave();
    expect(a.library.read(slug)?.title).toBe("Private paste");
    clock.advance(1000);
    expect(a.library.read(slug)?.title).toBe("Private paste");
    expect(a.library.privacy(slug).private).toBe(true);
  });

  it("a background room made Private exports a Private recovery copy", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 66);
    const slug = await start(a);
    // Its canvas isn't showing: no capture, only the room's projection (no flags of its own).
    a.room.configure({ capture: () => undefined });
    a.library.markPrivate = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    a.library.flags.set(slug, { private: true });
    a.library.changed();
    await a.room.getSnapshot().open!.session.idle();
    expect(a.room.getSnapshot().open?.unsaved).toBe(true);
    expect(serializeNative(a.room.unsavedDiagram()!)).toContain('"private": true');
  });

  it("a diagram marked Private while its room opens sends nothing", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 58),
      b = browser(net, clock, 59);
    const slug = await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    a.room.pageHidden();
    await settle(net, b);
    const record = a.tab.read()!;
    // Before the keys are ready: no transport at all.
    const early = browser(net, clock, 60, a);
    const opening = early.room.resume();
    a.library.flags.set(slug, { private: true });
    a.library.changed();
    await opening;
    expect(early.transports).toHaveLength(0);
    expect(early.room.getSnapshot().notice).toMatchObject({ kind: "private", slug });
    // While recovery loads: the transport exists, but not a frame leaves it.
    a.library.flags.delete(slug);
    a.tab.write(record);
    const late = browser(net, clock, 61, { ...a, store: new Store() });
    late.store.records = a.store.records;
    let release = () => {};
    late.store.headHold = new Promise((resolve) => (release = resolve));
    const sent: string[] = [];
    net.tap((r) => sent.push(r.from));
    const resuming = late.room.resume();
    await vi.waitFor(() => expect(late.transports).toHaveLength(1));
    a.library.flags.set(slug, { private: true });
    a.library.changed();
    release();
    await resuming;
    await settle(net, b);
    expect(late.room.getSnapshot().open).toBeUndefined();
    expect(late.room.getSnapshot().notice).toMatchObject({ kind: "private", slug });
    expect(sent.filter((from) => from === late.transports[0].self)).toEqual([]);
  });

  it("resuming, then a crash before the checkpoint acknowledges, keeps the edits", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 62);
    await start(a);
    a.store.hold = new Promise(() => {});
    edit(a, (d) => ({ ...d, title: "Unsaved through two reloads" }));
    a.room.pageHidden();
    const tab = memoryTabRoom();
    tab.text = a.tab.text;
    const shared = (hold?: Promise<void>) => {
      const store = new Store();
      store.records = a.store.records;
      store.hold = hold;
      return store;
    };
    const first = browser(net, clock, 63, { library: a.library, tab, store: shared(new Promise(() => {})) });
    await first.room.resume();
    expect(titleOf(first)).toBe("Unsaved through two reloads");
    expect(first.tab.read()?.pending).toBeDefined();
    // The page dies before its checkpoint write is acknowledged (no pagehide).
    const second = browser(net, clock, 64, { library: a.library, tab, store: shared() });
    await second.room.resume();
    expect(titleOf(second)).toBe("Unsaved through two reloads");
  });

  it("an away tab says so to the others, and back again", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 70),
      b = browser(net, clock, 71);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    b.room.setAway(true);
    await settle(net, a, b);
    expect(session(a).peers()[0].status).toBe("away");
    b.room.setAway(false);
    await settle(net, a, b);
    expect(session(a).peers()[0].status).toBe("active");
  });

  it("writes the copy only when the room changed", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 42);
    await start(a);
    let saves = 0;
    const save = a.library.save.bind(a.library);
    a.library.save = (slug, d) => (saves++, save(slug, d));
    a.room.flush();
    saves = 0;
    edit(a, (d) => ({ ...d, title: "One change" }));
    a.room.flush();
    a.room.flush();
    a.room.flush();
    expect(saves).toBe(1);
  });

  it("the open room's own link pasted into its tab changes nothing", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 23);
    await start(a);
    const url = new URL(linkOf(a));
    a.room.readAddress({ hash: url.hash, pathname: "/", search: "" }, nohistory);
    expect(a.room.getSnapshot().prompt).toBeUndefined();
    expect(a.transports).toHaveLength(1);
  });

  it("back from the back/forward cache, the same document rejoins with a new editor mount", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 24),
      b = browser(net, clock, 25);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    const before = b.room.getSnapshot().open!;
    b.room.suspend();
    await settle(net, a);
    expect(session(a).transport.peers()).toHaveLength(0);
    edit(a, (d) => ({ ...d, title: "While B was away" }));
    await b.room.restore();
    const after = b.room.getSnapshot().open!;
    expect(after.mount).not.toBe(before.mount);
    expect(after.session.doc).toBe(before.session.doc);
    expect(after.slug).toBe(before.slug);
    await settle(net, a, b);
    expect(titleOf(b)).toBe("While B was away");
  });

  it("Clear everything stops the room without asking it to save, and forgets the tab's room", async () => {
    const net = new MemoryNetwork(),
      clock = new FakeClock();
    const a = browser(net, clock, 26),
      b = browser(net, clock, 27);
    await start(a);
    await join(b, linkOf(a));
    await settle(net, a, b);
    b.room.wipe();
    expect(b.tab.read()).toBeUndefined();
    expect(b.room.getSnapshot().open).toBeDefined();
    await settle(net, a);
    expect(session(a).transport.peers()).toHaveLength(0);
    await a.room.leave();
  });
});
