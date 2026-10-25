import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { SaveTarget } from "./diagramIO";
import type { FileHandle } from "../interop/files";
import { writeHandle } from "../interop/files";
import { editMessageProps, messageRules } from "../model/messageRules";

// Downloads are observed, not performed (Node has no document).
vi.mock("../interop/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../interop/files")>()),
  downloadText: vi.fn(),
}));

// Node has no localStorage: a Map-backed stand-in (installed before diagramIO is imported).
class MemoryStorage {
  private m = new Map<string, string>();
  quotaBytes = Infinity;
  failKey: string | undefined;
  beforeWrite: ((key: string) => void) | undefined;
  get length() {
    return this.m.size;
  }
  key = (i: number) => [...this.m.keys()][i] ?? null;
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => {
    this.beforeWrite?.(k);
    if (k === this.failKey) throw new DOMException("full", "QuotaExceededError");
    if (v.length > this.quotaBytes) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  };
  removeItem = (k: string) => void this.m.delete(k);
  clear = () => this.m.clear();
}
const storage = new MemoryStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;
let io = await import("./diagramIO");
let { newDiagramsPrivate } = await import("./privacyPrefs");
let toast = await import("../interop/ui/toast");

const good: DiagramFile = {
  format: "diagrams/v1",
  title: "Good",
  nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }],
  edges: [],
};
const handle: FileHandle = {
  kind: "file",
  name: "a.json",
  getFile: async () => new File([], "a.json"),
  createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn() })),
};
/** A device destination: the handle itself, kept in memory only. */
const device: SaveTarget = { providerId: "device", ref: handle, name: handle.name };

beforeEach(async () => {
  storage.clear();
  storage.quotaBytes = Infinity;
  storage.failKey = undefined;
  storage.beforeWrite = undefined;
  vi.clearAllMocks();
  vi.resetModules();
  io = await import("./diagramIO");
  ({ newDiagramsPrivate } = await import("./privacyPrefs"));
  toast = await import("../interop/ui/toast");
});

describe("diagramIO storage goes through the shared validator", () => {
  it("autosaves derived rules in their authored form and persists only a changed rule's identity", () => {
    const input = structuredClone(good);
    input.nodes[0].props = { emits: { A: "B", C: "D" } };
    const loaded = structuredClone(input);
    expect(io.writeAutosave(io.LEGACY_SLUG, loaded)).toBe(true);
    expect(io.getAutosave(io.LEGACY_SLUG)).toEqual(input);
    expect(storage.getItem("diagrams.autosave.v1:imported")).not.toContain("rule-");
    const props = loaded.nodes[0].props!;
    const rows = messageRules(props.emits);
    loaded.nodes[0].props = editMessageProps({ emits: [{ ...rows[0], sends: "Edited" }, rows[1]] }, props);
    expect(io.writeAutosave(io.LEGACY_SLUG, loaded)).toBe(true);
    expect(io.getAutosave(io.LEGACY_SLUG)?.nodes[0].props?.emits).toEqual([
      { id: rows[0].id, receives: "A", sends: "Edited" },
      { receives: "C", sends: "D" },
    ]);
  });
  it.each(["legacy", "library"])("loads oversized %s originals and autosaves losslessly", (kind) => {
    const legacy = {
      ...good,
      description: "d".repeat(2001),
      nodes: [{ ...good.nodes[0], description: "n".repeat(50_001) }],
    };
    const slug = kind === "legacy" ? io.LEGACY_SLUG : io.createLibraryDiagram(good);
    const key = kind === "legacy" ? "diagrams.imported.v1" : `diagrams.doc.v1:${slug.slice(3)}`;
    const stored = kind === "legacy" ? legacy : { ...JSON.parse(storage.getItem(key)!), diagram: legacy };
    storage.setItem(key, JSON.stringify(stored));
    const edited = { ...legacy, title: "Autosaved edit" };
    storage.setItem(
      `diagrams.autosave.v1:${slug}`,
      JSON.stringify(kind === "legacy" ? edited : { ...stored, diagram: edited }),
    );
    expect(io.getOriginal(slug)).toEqual(legacy);
    expect(io.getAutosave(slug)).toEqual(edited);
    expect(io.getCurrent(slug)).toEqual(edited);
    expect(io.writeAutosave(slug, { ...edited, title: "Next edit" })).toBe(true);
    expect(io.getCurrent(slug)).toEqual({ ...edited, title: "Next edit" });
    expect(io.parseDiagram(JSON.stringify(legacy))).toMatchObject({ ok: true, diagram: legacy });
  });
  it("keeps the whole-document size cap exclusive to imports", () => {
    const diagram = { ...good, description: "d".repeat(8_000_001) };
    const raw = JSON.stringify(diagram);
    storage.setItem("diagrams.imported.v1", raw);
    storage.setItem("diagrams.autosave.v1:imported", raw);
    expect(io.getOriginal(io.LEGACY_SLUG)).toEqual(diagram);
    expect(io.getAutosave(io.LEGACY_SLUG)).toEqual(diagram);
    expect(io.parseDiagram(raw)).toMatchObject({ ok: false, error: expect.stringContaining("too large") });
  });

  it("an autosave finishing during deletion cannot re-list the deleted diagram", () => {
    const slug = io.createLibraryDiagram(good);
    let undo: (() => boolean) | undefined;
    storage.beforeWrite = (key) => {
      if (key !== `diagrams.library-entry.v1:${slug}`) return;
      storage.beforeWrite = undefined;
      undo = io.deleteLibraryDiagram(slug);
    };
    io.writeAutosave(slug, { ...good, title: "Latest edit" });
    expect(io.hasLibraryEntry(slug)).toBe(false);
    expect(io.writeAutosave(slug, good)).toBe(false);
    expect(undo?.()).toBe(true);
    expect(io.getCurrent(slug)?.title).toBe("Latest edit");
    expect(io.listLibrary()[0].title).toBe("Latest edit");
  });
  it("migrates a legacy autosave without an original, preserving content and identity", () => {
    storage.setItem("diagrams.autosave.v1:imported", JSON.stringify(good));
    const identity = io.getDiagramIdentity(io.LEGACY_SLUG);
    io.migrateLegacySlot();
    io.migrateLegacySlot();
    expect(io.getOriginal(io.LEGACY_SLUG)).toEqual(good);
    expect(io.getCurrent(io.LEGACY_SLUG)).toEqual(good);
    expect(io.getDiagramIdentity(io.LEGACY_SLUG)).toBe(identity);
    expect(io.listLibrary().map((e) => e.title)).toEqual(["Good"]);
  });

  it("rename rolls back when the autosave write fails after the original write", () => {
    const slug = io.createLibraryDiagram(good);
    const identity = io.getDiagramIdentity(slug);
    io.writeAutosave(slug, { ...good, title: "Edited" }, identity);
    const before = Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((key) => [
      key,
      storage.getItem(key),
    ]);
    storage.failKey = `diagrams.autosave.v1:${slug}`;
    expect(() => io.renameLibraryDiagram(slug, "Renamed")).toThrow(/storage/);
    expect(before.map(([key]) => [key, storage.getItem(key!)])).toEqual(before);
    expect(io.getDiagramIdentity(slug)).toBe(identity);
    expect(io.getOriginal(slug)?.title).toBe("Good");
    expect(io.getCurrent(slug)?.title).toBe("Edited");
    expect(io.listLibrary()[0].title).toBe("Edited");
  });

  it("notifies subscribers after autosaves refresh metadata", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    try {
      const slug = io.createLibraryDiagram(good);
      dispatchEvent.mockClear();
      expect(io.writeAutosave(slug, { ...good, title: "Updated", nodes: [] })).toBe(true);
      expect(io.listLibrary()[0]).toMatchObject({ title: "Updated", nodes: 0 });
      expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: io.DIAGRAMS_CHANGED }));
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("rejects an invalid diagram without adding it to Your diagrams", () => {
    const bad = { ...good, title: "Bad", edges: [{ id: "e", from: "a", to: "ghost" }] } as DiagramFile;
    expect(() => io.createLibraryDiagram(bad)).toThrow(/points at a node/);
    expect(io.listLibrary()).toEqual([]);
  });

  it("stores the repaired form of malformed groups", () => {
    const slug = io.createLibraryDiagram({ ...good, groups: {} } as unknown as DiagramFile);
    expect(io.getOriginal(slug)?.groups).toBeUndefined();
  });

  it("treats tampered storage as missing instead of crashing the canvas", () => {
    const slug = io.createLibraryDiagram(good);
    storage.setItem(`diagrams.doc.v1:${slug.slice(3)}`, JSON.stringify({ ...good, nodes: [{ id: "a" }] }));
    expect(io.getOriginal(slug)).toBeUndefined();
    storage.setItem("diagrams.autosave.v1:kafka-order-pipeline", "{ not json");
    expect(io.getAutosave("kafka-order-pipeline")).toBeUndefined();
    storage.setItem("diagrams.autosave.v1:x", JSON.stringify({ ...good, groups: [null] }));
    expect(io.getAutosave("x")?.groups).toBeUndefined();
  });

  it("reports full storage with an actionable message and leaves nothing half-written", () => {
    io.createLibraryDiagram(good);
    const before = storage.getItem(io.LIBRARY_KEY);
    storage.quotaBytes = 10;
    expect(() => io.createLibraryDiagram({ ...good, title: "Newer" })).toThrow(/storage .* full.*Your diagrams/);
    storage.quotaBytes = Infinity;
    expect(storage.getItem(io.LIBRARY_KEY)).toBe(before);
    expect(io.listLibrary().map((e) => e.title)).toEqual(["Good"]);
  });

  it("parseDiagram is the native validator", () => {
    expect(io.parseDiagram(JSON.stringify(good)).ok).toBe(true);
    const r = io.parseDiagram(JSON.stringify({ ...good, groups: [null] }));
    expect(r.ok && r.diagram.groups).toBeUndefined();
  });
});

describe("autosave", () => {
  it("never throws: returns false when storage is full", () => {
    storage.quotaBytes = 10;
    expect(io.writeAutosave("x", good)).toBe(false);
    storage.quotaBytes = Infinity;
    expect(io.writeAutosave("x", good)).toBe(true);
    expect(io.getAutosave("x")?.title).toBe("Good");
  });

  it("a late write for a document that was replaced is refused (the unmount flush guard)", () => {
    io.setShared(good);
    const old = io.getDiagramIdentity("shared");
    io.setShared({ ...good, title: "B" });
    expect(io.writeAutosave("shared", { ...good, title: "Stale edit" }, old)).toBe(false);
    expect(io.getAutosave("shared")).toBeUndefined();
    expect(io.writeAutosave("shared", { ...good, title: "B edit" }, io.getDiagramIdentity("shared"))).toBe(true);
    expect(io.getAutosave("shared")?.title).toBe("B edit");
  });

  it("keeps the library entry's title, node count and thumbnail in step", () => {
    const slug = io.createLibraryDiagram(good);
    const two = {
      ...good,
      title: "Renamed",
      nodes: [...good.nodes, { id: "b", stencil: "kafka.topic", label: "B", x: 400, y: 0 }],
    };
    io.writeAutosave(slug, two, io.getDiagramIdentity(slug));
    const [entry] = io.listLibrary();
    expect(entry).toMatchObject({ slug, title: "Renamed", nodes: 2 });
    expect(entry.thumb.nodes).toHaveLength(2);
  });
});

describe("Your diagrams (the library)", () => {
  it("Open and Import add entries instead of replacing, most recent first", () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1000);
    const a = io.createLibraryDiagram({ ...good, title: "A" });
    now.mockReturnValue(2000);
    const b = io.createLibraryDiagram({ ...good, title: "B" });
    now.mockRestore();
    expect(a).not.toBe(b);
    expect(io.isLibrarySlug(a) && io.isLibrarySlug(b)).toBe(true);
    expect(io.listLibrary().map((e) => e.title)).toEqual(["B", "A"]);
    expect(io.getOriginal(a)?.title).toBe("A");
  });

  it("each entry has its own save destination: binding B never reaches A's handle", async () => {
    const a = io.createLibraryDiagram(good, device);
    const b = io.createLibraryDiagram({ ...good, title: "B" });
    expect(io.getSaveTarget(a)).toEqual(device);
    const target = io.getSaveTarget(b);
    if (target?.providerId === "device") await writeHandle(target.ref as FileHandle, "B");
    expect(target).toBeUndefined();
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it("publishes a supplied Drive destination in the same stored session as its diagram", () => {
    const slug = io.createLibraryDiagram(good, { providerId: "gdrive", ref: { id: "a" }, name: "A" });
    const raw = JSON.parse(storage.getItem(`diagrams.doc.v1:${slug.slice(3)}`)!);
    expect(raw).toMatchObject({
      diagram: { title: "Good" },
      target: { providerId: "gdrive", ref: { id: "a" } },
      sessionId: io.getDiagramIdentity(slug),
    });
    expect(io.getSaveTarget(slug)).toEqual({ providerId: "gdrive", ref: { id: "a" }, name: "A" });
  });

  it("stores any provider's { providerId, ref } with its document; device handles never reach storage", () => {
    const slug = io.createLibraryDiagram(good, {
      providerId: "onedrive",
      ref: { id: "item-1" },
      name: "a.diagram.json",
      savedAt: 5,
    });
    expect(io.getSaveTarget(slug)).toEqual({
      providerId: "onedrive",
      ref: { id: "item-1" },
      name: "a.diagram.json",
      savedAt: 5,
    });
    const identity = io.getDiagramIdentity(slug);
    expect(io.bindSaveTarget(slug, device, identity)).toBe(true);
    const raw = JSON.parse(storage.getItem(`diagrams.doc.v1:${slug.slice(3)}`)!);
    expect(raw.target).toBeUndefined();
    expect(io.getSaveTarget(slug)).toEqual(device);
    // Binding a provider again replaces the in-memory device destination.
    const dropbox = { providerId: "dropbox", ref: { id: "id:x" }, name: "b.diagram.json" };
    expect(io.bindSaveTarget(slug, dropbox, identity)).toBe(true);
    expect(io.getSaveTarget(slug)).toEqual(dropbox);
  });

  it("still reads a Google Drive destination stored before storage providers", () => {
    const slug = io.createLibraryDiagram(good);
    const key = `diagrams.doc.v1:${slug.slice(3)}`;
    const raw = JSON.parse(storage.getItem(key)!);
    storage.setItem(key, JSON.stringify({ ...raw, drive: { kind: "drive", id: "old", name: "Old.diagram.json" } }));
    expect(io.getSaveTarget(slug)).toEqual({ providerId: "gdrive", ref: { id: "old" }, name: "Old.diagram.json" });
  });

  it("ignores malformed stored destinations", () => {
    const slug = io.createLibraryDiagram(good);
    const key = `diagrams.doc.v1:${slug.slice(3)}`;
    const raw = JSON.parse(storage.getItem(key)!);
    for (const target of [{ providerId: "device", ref: {}, name: "x" }, { providerId: "onedrive", name: "x" }, "x"]) {
      storage.setItem(key, JSON.stringify({ ...raw, target }));
      expect(io.getSaveTarget(slug)).toBeUndefined();
    }
  });

  it("duplicates the latest content with a fresh identity and no destination", () => {
    const slug = io.createLibraryDiagram({ ...good, "x-owner": "team" } as DiagramFile, {
      providerId: "gdrive",
      ref: { id: "a" },
      name: "A",
    });
    io.writeAutosave(slug, { ...good, title: "Edited" }, io.getDiagramIdentity(slug));
    const copy = io.duplicateLibraryDiagram(slug);
    expect(io.getOriginal(copy)).toMatchObject({ title: "Edited (copy)", "x-owner": "team" });
    expect(io.getDiagramIdentity(copy)).not.toBe(io.getDiagramIdentity(slug));
    expect(io.getSaveTarget(copy)).toBeUndefined();
    expect(io.getOriginal(io.duplicateLibraryDiagram(copy))?.title).toBe("Edited (copy 2)");
  });

  it("renames a closed entry (original, edits and index) without changing its identity", () => {
    const slug = io.createLibraryDiagram(good);
    const identity = io.getDiagramIdentity(slug);
    io.writeAutosave(slug, { ...good, title: "Edited" }, identity);
    io.renameLibraryDiagram(slug, "  Orders  ");
    expect(io.getDiagramIdentity(slug)).toBe(identity);
    expect(io.getOriginal(slug)?.title).toBe("Orders");
    expect(io.getAutosave(slug)?.title).toBe("Orders");
    expect(io.listLibrary()[0].title).toBe("Orders");
  });

  it("deletes an entry, and Undo restores it exactly (edits and destination included)", () => {
    const slug = io.createLibraryDiagram(good, device);
    const identity = io.getDiagramIdentity(slug);
    io.writeAutosave(slug, { ...good, title: "Edited" }, identity);
    const undo = io.deleteLibraryDiagram(slug);
    expect(io.listLibrary()).toEqual([]);
    expect(io.getOriginal(slug)).toBeUndefined();
    expect(io.getSaveTarget(slug)).toBeUndefined();
    // A canvas still open on it can't write it back to life.
    expect(io.writeAutosave(slug, good, identity)).toBe(false);
    expect(undo()).toBe(true);
    expect(io.listLibrary().map((e) => e.slug)).toEqual([slug]);
    expect(io.getAutosave(slug)?.title).toBe("Edited");
    expect(io.getSaveTarget(slug)).toEqual(device);
  });

  it("deleting a diagram deletes its AI conversation too, and Undo puts it back", () => {
    const slug = io.createLibraryDiagram(good);
    const other = io.createLibraryDiagram({ ...good, title: "Other" });
    const thread = `diagrams.ai-thread.v1:${io.getDiagramIdentity(slug)}`;
    const otherThread = `diagrams.ai-thread.v1:${io.getDiagramIdentity(other)}`;
    storage.setItem(thread, JSON.stringify({ turns: [{ request: "Add the payroll ledger" }] }));
    storage.setItem(otherThread, "{}");
    const undo = io.deleteLibraryDiagram(slug);
    expect(storage.getItem(thread)).toBeNull();
    expect(storage.getItem(otherThread)).toBe("{}");
    expect(undo()).toBe(true);
    expect(storage.getItem(thread)).toContain("payroll ledger");
  });

  it("deleting a diagram takes its title out of the old all-in-one index too; Undo still lists it", () => {
    const slug = io.createLibraryDiagram({ ...good, title: "Payroll ledger" });
    io.migrateLegacySlot();
    // A browser that used the app before per-entry records: the old index lists the diagram by title.
    storage.setItem(io.LIBRARY_KEY, JSON.stringify({ format: "diagrams/library/v1", entries: io.listLibrary() }));
    expect(storage.getItem(io.LIBRARY_KEY)).toContain("Payroll ledger");
    const undo = io.deleteLibraryDiagram(slug);
    expect(storage.getItem(io.LIBRARY_KEY)).not.toContain("Payroll ledger");
    expect(undo()).toBe(true);
    expect(io.listLibrary().map((e) => e.title)).toEqual(["Payroll ledger"]);
  });

  it("two tabs deleting at once can't bring a title back into the old index", () => {
    // Three diagrams listed only in the old all-in-one index (a browser from before per-entry records).
    const slugs = ["Payroll ledger", "Bonus run", "Expenses"].map((title) =>
      io.createLibraryDiagram({ ...good, title }),
    );
    const rows = slugs.map((s) => JSON.parse(storage.getItem(`diagrams.library-entry.v1:${s}`)!));
    for (const s of slugs) storage.removeItem(`diagrams.library-entry.v1:${s}`);
    storage.setItem(io.LIBRARY_KEY, JSON.stringify({ format: "diagrams/library/v1", entries: rows }));
    expect(io.listLibrary()).toHaveLength(3);
    // This tab deletes the first; as it writes the old index, another tab deletes the second.
    let raced = false;
    storage.beforeWrite = (key) => {
      if (key !== io.LIBRARY_KEY || raced) return;
      raced = true;
      io.deleteLibraryDiagram(slugs[1]);
    };
    io.deleteLibraryDiagram(slugs[0]);
    storage.beforeWrite = undefined;
    expect(raced).toBe(true);
    const index = storage.getItem(io.LIBRARY_KEY)!;
    expect(index).not.toContain("Payroll ledger");
    expect(index).not.toContain("Bonus run");
    expect(io.listLibrary().map((e) => e.title)).toEqual(["Expenses"]);
  });

  it("a shared diagram replaced or cleared takes its AI conversation with it", () => {
    io.setShared(good);
    const first = `diagrams.ai-thread.v1:${io.getDiagramIdentity(io.SHARED_SLUG)}`;
    storage.setItem(first, "{}");
    io.setShared({ ...good, title: "Next" });
    expect(storage.getItem(first)).toBeNull();
    const second = `diagrams.ai-thread.v1:${io.getDiagramIdentity(io.SHARED_SLUG)}`;
    storage.setItem(second, "{}");
    io.clearShared();
    expect(storage.getItem(second)).toBeNull();
  });

  it("a delete that can't update the index deletes nothing", () => {
    const slug = io.createLibraryDiagram(good);
    storage.quotaBytes = 5;
    expect(() => io.deleteLibraryDiagram(slug)).toThrow(/storage/);
    storage.quotaBytes = Infinity;
    expect(io.getOriginal(slug)?.title).toBe("Good");
  });

  it("a corrupt index reads as empty instead of crashing, and bad entries are skipped", () => {
    storage.setItem(io.LIBRARY_KEY, "{ nope");
    expect(io.listLibrary()).toEqual([]);
    storage.setItem(
      io.LIBRARY_KEY,
      JSON.stringify({
        format: "diagrams/library/v1",
        entries: [
          { slug: "my-abcdef12", title: "Kept", createdAt: 1, updatedAt: 1, nodes: 0, thumb: { bad: true } },
          { slug: "kafka-order-pipeline", title: "Not a library slug", createdAt: 1, updatedAt: 1, nodes: 0 },
          { slug: "my-abcdef12", title: "Duplicate", createdAt: 1, updatedAt: 1, nodes: 0 },
          null,
        ],
      }),
    );
    const list = io.listLibrary();
    expect(list.map((e) => e.title)).toEqual(["Kept"]);
    expect(list[0].thumb.nodes).toEqual([]);
  });
});

describe("the blank draft", () => {
  it("isn't stored until its first edit, then becomes an entry with the draft's identity", () => {
    io.newDraft();
    expect(io.getOriginal(io.DRAFT_SLUG)?.nodes).toEqual([]);
    const identity = io.getDiagramIdentity(io.DRAFT_SLUG);
    expect(io.writeAutosave(io.DRAFT_SLUG, null, identity)).toBe(true);
    expect(io.listLibrary()).toEqual([]);
    expect(io.writeAutosave(io.DRAFT_SLUG, good, identity)).toBe(true);
    const slug = io.resolveSlug(io.DRAFT_SLUG);
    expect(io.isLibrarySlug(slug)).toBe(true);
    // Same identity: the open canvas keeps its key (no remount), and later writes land in the entry.
    expect(io.getDiagramIdentity(slug)).toBe(identity);
    expect(io.getAutosave(slug)?.title).toBe("Good");
    expect(io.writeAutosave(io.DRAFT_SLUG, { ...good, title: "Second" }, identity)).toBe(true);
    expect(io.listLibrary().map((e) => e.title)).toEqual(["Second"]);
    io.newDraft();
    expect(io.resolveSlug(io.DRAFT_SLUG)).toBe(io.DRAFT_SLUG);
    // A canvas from the previous draft can't write into the new one.
    expect(io.writeAutosave(io.DRAFT_SLUG, good, "draft:stale")).toBe(false);
    expect(io.listLibrary()).toHaveLength(1);
  });

  it("saving a blank draft keeps it, bound to the destination", () => {
    io.newDraft();
    const identity = io.getDiagramIdentity(io.DRAFT_SLUG);
    expect(io.bindSaveTarget(io.DRAFT_SLUG, device, identity)).toBe(true);
    const slug = io.resolveSlug(io.DRAFT_SLUG);
    expect(io.getSaveTarget(slug)).toEqual(device);
  });
});

describe("the shared slot", () => {
  it("replacing it drops the old destination and edits", () => {
    io.setShared(good, device);
    io.writeAutosave("shared", { ...good, title: "Edited" });
    io.setShared({ ...good, title: "B" });
    expect(io.getSaveTarget("shared")).toBeUndefined();
    expect(io.getAutosave("shared")).toBeUndefined();
  });

  it("failed replacement retains both the old document and its destination", () => {
    io.setShared(good, device);
    const identity = io.getDiagramIdentity("shared");
    storage.quotaBytes = 10;
    expect(() => io.setShared({ ...good, title: "B" })).toThrow(/storage/);
    storage.quotaBytes = Infinity;
    expect(io.getDiagramIdentity("shared")).toBe(identity);
    expect(io.getSaveTarget("shared")).toEqual(device);
    expect(io.getShared()?.title).toBe("Good");
  });

  it("a late Save As result cannot bind to a replacement document", () => {
    io.setShared(good);
    const identity = io.getDiagramIdentity("shared");
    io.setShared({ ...good, title: "B" });
    expect(io.bindSaveTarget("shared", device, identity)).toBe(false);
    expect(io.getSaveTarget("shared")).toBeUndefined();
  });

  it("unrelated changes preserve the open document identity", () => {
    const slug = io.createLibraryDiagram(good);
    const mine = io.getDiagramIdentity(slug);
    const example = io.getDiagramIdentity("kafka-order-pipeline");
    io.setShared(good);
    io.createLibraryDiagram({ ...good, title: "Other" });
    expect(io.getDiagramIdentity(slug)).toBe(mine);
    expect(io.getDiagramIdentity("kafka-order-pipeline")).toBe(example);
  });

  it("stale autosave cannot hide a replacement even when removal fails", () => {
    io.setShared(good);
    io.writeAutosave("shared", good);
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      io.setShared({ ...good, title: "B" });
      expect(io.getAutosave("shared")).toBeUndefined();
      expect(io.getShared()?.title).toBe("B");
    } finally {
      remove.mockRestore();
    }
  });
});

describe("upgrading the single 'Your diagram' slot", () => {
  it("lists it in place, preferring its edits, and keeps its autosave (no copying)", () => {
    storage.setItem("diagrams.imported.v1", JSON.stringify(good));
    storage.setItem("diagrams.autosave.v1:imported", JSON.stringify({ ...good, title: "Legacy edit" }));
    expect(io.listLibrary().map((e) => [e.slug, e.title])).toEqual([["imported", "Legacy edit"]]);
    io.migrateLegacySlot();
    expect(JSON.parse(storage.getItem(io.LIBRARY_KEY)!).entries[0]).toMatchObject({ slug: "imported" });
    expect(io.getAutosave("imported")?.title).toBe("Legacy edit");
    expect(io.getOriginal("imported")?.title).toBe("Good");
    // Idempotent.
    io.migrateLegacySlot();
    expect(io.listLibrary()).toHaveLength(1);
  });

  it("skips an untouched blank slot", () => {
    storage.setItem("diagrams.imported.v1", JSON.stringify(io.emptyDiagram()));
    io.migrateLegacySlot();
    expect(io.listLibrary()).toEqual([]);
  });

  it("works even when the index can't be written (full storage)", () => {
    storage.setItem("diagrams.imported.v1", JSON.stringify(good));
    storage.quotaBytes = 10;
    io.migrateLegacySlot();
    expect(io.listLibrary().map((e) => e.slug)).toEqual(["imported"]);
  });

  it("never restores a legacy slot's separately stored destination", () => {
    const extended = {
      ...good,
      sessionId: "extension",
      diagram: { ...good, title: "Nested extension" },
      drive: { kind: "drive", id: "wrong", name: "Wrong" },
    };
    storage.setItem("diagrams.imported.v1", JSON.stringify(extended));
    storage.setItem(
      "diagrams.bindings.v1",
      JSON.stringify({ imported: { providerId: "gdrive", ref: { id: "a" }, name: "A" } }),
    );
    expect(io.getOriginal("imported")?.title).toBe("Good");
    expect(io.getSaveTarget("imported")).toBeUndefined();
  });

  it("the first explicit Save upgrades the legacy slot without remounting it or discarding its autosave", () => {
    storage.setItem("diagrams.imported.v1", JSON.stringify(good));
    storage.setItem("diagrams.autosave.v1:imported", JSON.stringify({ ...good, title: "Legacy edit" }));
    const identity = io.getDiagramIdentity("imported");
    expect(
      io.bindSaveTarget("imported", { providerId: "gdrive", ref: { id: "explicit" }, name: "Saved" }, identity),
    ).toBe(true);
    expect(io.getDiagramIdentity("imported")).toBe(identity);
    expect(io.getSaveTarget("imported")).toEqual({ providerId: "gdrive", ref: { id: "explicit" }, name: "Saved" });
    expect(io.getAutosave("imported")?.title).toBe("Legacy edit");
  });
});

describe("the storage budget", () => {
  it("measures what the site keeps and warns once when nearly full", () => {
    io.createLibraryDiagram(good);
    expect(io.storageUsage().used).toBeGreaterThan(0);
    expect(io.warnIfNearlyFull()).toBe(false);
    storage.setItem("filler", "x".repeat(io.STORAGE_BUDGET * 0.85));
    expect(io.storageUsage().ratio).toBeGreaterThan(io.NEARLY_FULL);
    expect(io.warnIfNearlyFull()).toBe(true);
    expect(toast.toast.current?.text).toMatch(/storage/);
    expect(toast.toast.current?.action?.label).toBe("Your diagrams");
    expect(io.warnIfNearlyFull()).toBe(false);
  });
});

it("storage reload retains a simulation after its referenced node is deleted", () => {
  const simulation = {
    id: "s",
    title: "S",
    traffic: [{ id: "t", node: "deleted", shape: { kind: "burst", count: 1 } as const }],
  };
  const slug = io.createLibraryDiagram({ ...good, simulations: [simulation] });
  expect(io.getOriginal(slug)?.simulations).toEqual([simulation]);
  io.writeAutosave(slug, { ...good, simulations: [simulation] });
  expect(io.getAutosave(slug)?.simulations).toEqual([simulation]);
});

it("creates document identities when randomUUID is unavailable on an HTTP deployment", () => {
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    io.setShared(good);
    const identity = io.getDiagramIdentity("shared");
    expect(identity).toMatch(/^[0-9a-f]{32}$/);
    io.setShared(good);
    expect(io.getDiagramIdentity("shared")).not.toBe(identity);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("copyTitle doesn't pile up suffixes", () => {
  expect(io.copyTitle("Orders")).toBe("Orders (copy)");
  expect(io.copyTitle("Orders (copy)", ["Orders (copy)"])).toBe("Orders (copy 2)");
  expect(io.copyTitle("Orders (copy 2)", ["Orders (copy)", "Orders (copy 2)"])).toBe("Orders (copy 3)");
});

it("clipboard ordering survives share links and library duplicate/reopen", async () => {
  const { makePayload, parsePayload, remapPayload } = await import("../editor/clipboard");
  const { encodeShare, decodeShare } = await import("../interop/share");
  const { toFlow } = await import("../canvas/convert");
  const { layersFixture } = await import("../lab/layersFixture");
  const source = { ...layersFixture, layerOrder: ["note", "service"] };
  const payload = parsePayload(JSON.stringify(makePayload(source, ["note", "service"])))!;
  const remapped = remapPayload(
    payload,
    { nodes: new Set(["note", "service"]), edges: new Set(), groups: new Set() },
    { x: 30, y: 30 },
  );
  const transferred: DiagramFile = { ...source, ...remapped, format: "diagrams/v1" };
  const shared = await decodeShare(await encodeShare(transferred));
  expect(shared.layerOrder).toEqual(["note-1", "service-1"]);
  const slug = io.createLibraryDiagram(shared);
  io.writeAutosave(slug, shared);
  const duplicate = io.duplicateLibraryDiagram(slug);
  for (const reopened of [io.getOriginal(slug)!, io.getCurrent(slug)!, io.getCurrent(duplicate)!]) {
    expect(reopened.layerOrder).toEqual(["note-1", "service-1"]);
    expect(toFlow(reopened).nodes.map((n) => n.id)).toEqual(["note-1", "service-1"]);
  }
});

it("Your diagrams keep relationships and settings through save, autosave and duplicate", () => {
  const withDeps: DiagramFile = {
    ...good,
    nodes: [...good.nodes, { id: "kv", stencil: "azure.key-vault", label: "Vault", x: 300, y: 0 }],
    edges: [
      {
        id: "a-kv",
        from: "a",
        to: "kv",
        relation: "secret",
        kind: "sync",
        props: { settings: [{ key: "Stripe:ApiKey", secret: true }] },
      },
    ],
  };
  const slug = io.createLibraryDiagram(withDeps);
  io.writeAutosave(slug, { ...withDeps, title: "Edited" });
  const duplicate = io.duplicateLibraryDiagram(slug);
  for (const reopened of [io.getOriginal(slug)!, io.getCurrent(slug)!, io.getCurrent(duplicate)!])
    expect(reopened.edges[0]).toMatchObject({
      relation: "secret",
      props: { settings: [{ key: "Stripe:ApiKey", secret: true }] },
    });
});

describe("first example edit", () => {
  it("promotion only copies: another tab keeps its conversation, identity and durable edits", async () => {
    const source = "kafka-order-pipeline";
    const original = await (await import("../examples")).loadExample(source);
    const firstId = io.getDiagramIdentity(source);
    const firstThread = await import("../ai/ui/thread");
    const turns = [{ id: "first", at: 1, request: "First tab", kind: "explain" as const, changed: [], after: good }];
    firstThread.saveThread(firstId, turns);
    vi.resetModules();
    const other = await import("./diagramIO");
    const otherThread = await import("../ai/ui/thread");
    const otherId = other.getDiagramIdentity(source);
    const otherTurns = [{ ...turns[0], id: "other", request: "Other tab" }];
    otherThread.saveThread(otherId, otherTurns);
    expect(other.writeAutosave(source, good, otherId)).toBe(true);
    const before = new Map(
      Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((key) => [key, storage.getItem(key)]),
    );
    const copy = io.copyEditedExample(source, original, firstId)!;
    for (const [key, value] of before) expect(storage.getItem(key), key).toBe(value);
    expect(io.getDiagramIdentity(source)).toBe(firstId);
    expect(io.getDiagramIdentity(copy.slug)).not.toBe(firstId);
    expect(firstThread.loadThread(io.getDiagramIdentity(copy.slug))).toEqual(turns);
    const continued = [{ ...otherTurns[0], request: "Still editing" }];
    expect(otherThread.saveThread(otherId, continued)).toBe(true);
    vi.resetModules();
    const reloaded = await import("./diagramIO");
    expect((await import("../ai/ui/thread")).loadThread(reloaded.getDiagramIdentity(source))).toEqual(continued);
    expect(reloaded.getAutosave(source)).toEqual(good);
  });
  it("copies a conversation using the same snapshot fallback as ordinary saves", async () => {
    const source = "kafka-order-pipeline";
    const original = await (await import("../examples")).loadExample(source);
    const identity = io.getDiagramIdentity(source);
    const thread = await import("../ai/ui/thread");
    const turns = [
      {
        id: "large",
        at: 1,
        request: "Keep words",
        kind: "explain" as const,
        changed: [],
        after: {
          ...good,
          nodes: Array.from({ length: 2 }, (_, index) => ({
            ...good.nodes[0],
            id: `node-${index}`,
            description: "x".repeat(50_000),
          })),
        },
      },
    ];
    storage.quotaBytes = 90_000;
    expect(thread.saveThread(identity, turns)).toBe(true);
    const copy = io.copyEditedExample(source, original, identity)!;
    expect(thread.loadThread(identity)).toEqual(turns);
    vi.resetModules();
    const reloaded = await import("./diagramIO");
    expect((await import("../ai/ui/thread")).loadThread(reloaded.getDiagramIdentity(copy.slug))).toEqual(
      turns.map(({ after: _after, ...turn }) => turn),
    );
  });
  it("identity reads never write or enumerate storage, even when storage is full", () => {
    storage.quotaBytes = 1;
    const read = vi.spyOn(storage, "getItem");
    const write = vi.spyOn(storage, "setItem");
    const enumerate = vi.spyOn(storage, "key");
    for (let i = 0; i < 100; i++)
      expect(io.getDiagramIdentity("kafka-order-pipeline")).toBe("example:kafka-order-pipeline");
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(enumerate).not.toHaveBeenCalled();
  });

  it("keeps another mounted session independent and able to promote its own pending snapshot", async () => {
    const source = "kafka-order-pipeline";
    const original = await (await import("../examples")).loadExample(source);
    const identity = io.getDiagramIdentity(source);
    const ownTarget = { providerId: "gdrive", ref: { id: "first-tab" }, name: "First destination" };
    io.bindSaveTarget(source, ownTarget, identity);
    vi.resetModules();
    const otherTab = await import("./diagramIO");
    await (await import("../examples")).loadExample(source);
    const otherIdentity = otherTab.getDiagramIdentity(source);
    expect(otherIdentity).toBe(identity);
    const otherTarget = { providerId: "gdrive", ref: { id: "other-tab" }, name: "Other destination" };
    otherTab.bindSaveTarget(source, otherTarget, otherIdentity);
    expect(io.getSaveTarget(source)).toEqual(ownTarget);
    const copy = otherTab.copyEditedExample(source, { ...original, title: "Other tab" }, otherIdentity)!;
    expect(io.getDiagramIdentity(source)).toBe(identity);
    expect(io.writeAutosave(source, good, identity)).toBe(true);
    const own = io.copyEditedExample(source, { ...original, title: "Pending here" }, identity)!;
    expect(io.getCurrent(own.slug)?.title).toBe("Pending here");
    expect(io.getCurrent(copy.slug)?.title).toBe("Other tab");
    expect(io.getSaveTarget(own.slug)).toEqual(ownTarget);
    expect(io.getSaveTarget(copy.slug)).toEqual(otherTarget);
    expect(io.getDiagramIdentity(own.slug)).not.toBe(io.getDiagramIdentity(copy.slug));
  });
  it("keeps an unpersisted session stable while storage is blocked", () => {
    storage.quotaBytes = 1;
    const identity = io.getDiagramIdentity("kafka-order-pipeline");
    expect(io.getDiagramIdentity("kafka-order-pipeline")).toBe(identity);
  });
  it("rolls back a copy when publication fails and retries without changing source keys", async () => {
    const source = "kafka-order-pipeline";
    const original = await (await import("../examples")).loadExample(source);
    const identity = io.getDiagramIdentity(source);
    const pending = io.trackDocumentSession(source);
    const thread = await import("../ai/ui/thread");
    const turns = [{ id: "kept", at: 1, request: "Keep me", kind: "explain" as const, changed: [] }];
    thread.saveThread(identity, turns);
    storage.beforeWrite = (key) => {
      if (key.startsWith("diagrams.library-entry.v1:")) storage.failKey = key;
    };
    expect(() => io.copyEditedExample(source, original, identity)).toThrow();
    expect(pending.resolve()).toEqual({ slug: source, identity });
    expect(io.listLibrary()).toHaveLength(0);
    expect(
      Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) =>
        key?.startsWith("diagrams.ai-thread.v1:"),
      ),
    ).toEqual([`diagrams.ai-thread.v1:${identity}`]);
    expect(thread.loadThread(identity)).toEqual(turns);
    expect(
      Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) =>
        key?.startsWith("diagrams.doc.v1:"),
      ),
    ).toEqual([]);
    storage.beforeWrite = undefined;
    storage.failKey = undefined;
    const copy = io.copyEditedExample(source, original, identity)!;
    expect(pending.resolve()?.slug).toBe(copy.slug);
    pending.dispose();
  });
  it.each([true, false])(
    "resolves pending privacy checks and binding to the same promoted owner (default Private: %s)",
    async (byDefault) => {
      const source = "kafka-order-pipeline";
      const original = await (await import("../examples")).loadExample(source);
      newDiagramsPrivate.set(byDefault);
      const identity = io.getDiagramIdentity(source);
      const pending = io.trackDocumentSession(source);
      const copy = io.copyEditedExample(source, original, identity)!;
      if (!byDefault) io.setDiagramPrivate(copy.slug, true);
      const session = pending.resolve()!;
      const owner = session.slug;
      expect(owner).toBe(copy.slug);
      expect(io.getPrivacyFlags(owner).private).toBe(true);
      expect(io.bindSaveTarget(owner, device, session.identity)).toBe(true);
      expect(io.getSaveTarget(owner)).toEqual(device);
      expect(io.getSaveTarget(source)).toBeUndefined();
      pending.dispose();
      newDiagramsPrivate.set(false);
    },
  );
  it.each([false, true])(
    "ignores an unscoped legacy cloud Save binding without rewriting it (generation: %s)",
    async (generation) => {
      const { loadExample } = await import("../examples");
      const source = "kafka-order-pipeline";
      const original = await loadExample(source);
      const target = { providerId: "gdrive", ref: { id: "legacy-file" }, name: "Existing file" };
      const sessionId = `example:${source}${generation ? ":older" : ""}`;
      if (generation) storage.setItem(`diagrams.example-session.v1:${source}`, JSON.stringify(sessionId));
      const binding = JSON.stringify({ [source]: { sessionId, target } });
      storage.setItem("diagrams.bindings.v1", binding);
      const identity = io.getDiagramIdentity(source);
      expect(io.getSaveTarget(source)).toBeUndefined();
      const copy = io.copyEditedExample(source, original, identity)!;
      expect(io.getSaveTarget(copy.slug)).toBeUndefined();
      expect(io.getSaveTarget(source)).toBeUndefined();
      expect(storage.getItem("diagrams.bindings.v1")).toBe(binding);
    },
  );
  it.each([device, { providerId: "gdrive", ref: { id: "saved-example" }, name: "Saved example" }])(
    "copies a completed $providerId Save destination to the owned copy",
    async (target) => {
      const { loadExample } = await import("../examples");
      const source = "kafka-order-pipeline";
      const original = await loadExample(source);
      const identity = io.getDiagramIdentity(source);
      expect(io.bindSaveTarget(source, target, identity)).toBe(true);
      const copy = io.copyEditedExample(source, original, identity)!;
      expect(io.getSaveTarget(copy.slug)).toEqual(target);
      if (target.providerId === "device") expect(io.getSaveTarget(copy.slug)?.ref).toBe(handle);
      expect(io.getSaveTarget(source)).toBeUndefined();
      io.setDiagramPrivate(copy.slug, true);
      const next = io.copyEditedExample(source, original, identity)!;
      expect(io.getSaveTarget(next.slug)).toBeUndefined();
      expect(io.getSaveTarget(copy.slug)).toEqual(target);
    },
  );
  it("pending saves follow only their first copy; a reopened example has a separate save", async () => {
    const source = "kafka-order-pipeline";
    const original = await (await import("../examples")).loadExample(source);
    const identity = io.getDiagramIdentity(source);
    const first = io.trackDocumentSession(source);
    const copy = io.copyEditedExample(source, original, identity)!;
    const second = io.trackDocumentSession(source);
    const nextCopy = io.copyEditedExample(source, original, identity)!;
    const owner = first.resolve()!;
    expect(io.bindSaveTarget(owner.slug, device, owner.identity)).toBe(true);
    expect(io.getSaveTarget(copy.slug)).toEqual(device);
    expect(io.getSaveTarget(nextCopy.slug)).toBeUndefined();
    expect(second.resolve()?.slug).toBe(nextCopy.slug);
    io.deleteLibraryDiagram(copy.slug);
    expect(first.resolve()).toBeUndefined();
    first.dispose();
    second.dispose();
  });
  it.each([true, false])(
    "reads legacy conversations and snapshots (autosave: %s) across reload and promotion",
    async (withAutosave) => {
      const { loadExample } = await import("../examples");
      const { loadThread } = await import("../ai/ui/thread");
      const source = "kafka-order-pipeline";
      const original = await loadExample(source);
      const edited = { ...original, title: "My retained work" };
      const thread = {
        turns: [{ id: "old-turn", at: 1, request: "Keep this", kind: "change", changed: [], after: edited }],
      };
      const oldKey = `diagrams.ai-thread.v1:example:${source}`;
      const autosaveKey = `diagrams.autosave.v1:${source}`;
      storage.setItem(oldKey, JSON.stringify(thread));
      if (withAutosave) storage.setItem(autosaveKey, JSON.stringify(edited));
      const identity = io.getDiagramIdentity(source);
      expect(loadThread(identity)).toEqual(thread.turns);
      expect(storage.getItem(oldKey)).toBe(JSON.stringify(thread));
      if (withAutosave) expect(io.getCurrent(source)).toEqual(edited);
      vi.resetModules();
      const reopened = await import("./diagramIO");
      await (await import("../examples")).loadExample(source);
      const reopenedIdentity = reopened.getDiagramIdentity(source);
      expect(reopenedIdentity).toBe(identity);
      expect((await import("../ai/ui/thread")).loadThread(reopenedIdentity)).toEqual(thread.turns);
      const copy = reopened.copyEditedExample(source, edited, reopenedIdentity)!;
      expect((await import("../ai/ui/thread")).loadThread(reopened.getDiagramIdentity(copy.slug))).toEqual(
        thread.turns,
      );
      expect(storage.getItem(autosaveKey)).toBe(withAutosave ? JSON.stringify(edited) : null);
      expect((await import("../ai/ui/thread")).loadThread(reopened.getDiagramIdentity(source))).toEqual(thread.turns);
      expect(reopened.getCurrent(source)).toEqual(withAutosave ? edited : original);
    },
  );
  it.each([false, true])("reads legacy state without writes while storage is blocked (modern: %s)", async (modern) => {
    vi.resetModules();
    const session = await import("./diagramIO");
    const { loadThread } = await import("../ai/ui/thread");
    const source = "kafka-order-pipeline";
    await (await import("../examples")).loadExample(source);
    const previousIdentity = `example:${source}${modern ? ":previous" : ""}`;
    const oldKey = `diagrams.ai-thread.v1:${previousIdentity}`;
    const autosaveKey = `diagrams.autosave.v1:${source}`;
    const turns = [{ id: "kept", at: 1, request: "Keep me", kind: "explain", changed: [], after: good }];
    const thread = JSON.stringify({ turns });
    storage.setItem(oldKey, thread);
    if (modern) storage.setItem(`diagrams.example-session.v1:${source}`, JSON.stringify(previousIdentity));
    storage.setItem(
      autosaveKey,
      JSON.stringify(
        modern ? { sessionFormat: "diagrams/session/v1", sessionId: previousIdentity, diagram: good } : good,
      ),
    );
    storage.quotaBytes = 1;
    const identity = session.getDiagramIdentity(source);
    expect(loadThread(identity)).toEqual(turns);
    expect(session.getCurrent(source)).toEqual(good);
    expect(session.getDiagramIdentity(source)).toBe(identity);
    const edited = {
      ...good,
      title: "Pending while full",
      nodes: good.nodes.map((node) => ({ ...node, label: "Pending edit" })),
    };
    expect(() => session.copyEditedExample(source, edited, identity)).toThrow();
    expect(storage.getItem(oldKey)).toBe(thread);
    storage.quotaBytes = Infinity;
    expect(session.getDiagramIdentity(source)).toBe(identity);
    expect(session.writeAutosave(source, edited, identity)).toBe(true);
    const copy = session.copyEditedExample(source, edited, identity)!;
    expect(copy).toBeDefined();
    const copyId = session.getDiagramIdentity(copy.slug);
    expect(copyId).not.toBe(identity);
    expect(session.writeAutosave(copy.slug, { ...edited, title: "Recovered" }, copyId)).toBe(true);
    expect(session.getCurrent(copy.slug)).toMatchObject({ title: "Recovered", nodes: [{ label: "Pending edit" }] });
    expect(loadThread(identity)).toEqual(turns);
  });
  it("leaves legacy generations untouched, including ones another tab could still use", async () => {
    const source = "kafka-order-pipeline";
    const canonical = `diagrams.ai-thread.v1:example:${source}`;
    const turns = [{ id: "kept", at: 1, request: "Keep me", kind: "explain" as const, changed: [], after: good }];
    storage.setItem(canonical + ":old", JSON.stringify({ turns }));
    storage.setItem(`diagrams.example-session.v1:${source}`, JSON.stringify(`example:${source}:old`));
    const before = new Map(
      Array.from({ length: storage.length }, (_, i) => storage.key(i)!).map((key) => [key, storage.getItem(key)]),
    );
    for (let reload = 0; reload < 3; reload++) {
      vi.resetModules();
      const reopened = await import("./diagramIO");
      await (await import("../examples")).loadExample(source);
      const thread = await import("../ai/ui/thread");
      const id = reopened.getDiagramIdentity(source);
      expect(thread.loadThread(id)).toEqual(turns);
      const copy = reopened.copyEditedExample(source, good, id)!;
      expect(thread.loadThread(reopened.getDiagramIdentity(copy.slug))).toEqual(turns);
      reopened.deleteLibraryDiagram(copy.slug);
      for (const [key, value] of before) expect(storage.getItem(key)).toBe(value);
      expect(thread.saveThread(id, [])).toBe(true);
      // An explicit empty conversation masks the legacy fallback, without deleting it.
      vi.resetModules();
      expect((await import("../ai/ui/thread")).loadThread(id)).toEqual([]);
      storage.removeItem(canonical);
    }
  });
  it("creates a named copy with a fresh identity and leaves the original untouched", async () => {
    const { loadExample } = await import("../examples");
    const source = "kafka-order-pipeline";
    const original = await loadExample(source);
    const identity = io.getDiagramIdentity(source);
    const edited = {
      ...original,
      nodes: original.nodes.map((n, i) => (i === 0 ? { ...n, label: "My edit" } : n)),
      "x-owner": "team",
    };
    const copy = io.copyEditedExample(source, edited, identity);
    expect(copy?.title).toBe(`${original.title} (copy)`);
    expect(copy).toBeDefined();
    if (!copy) throw new Error("Copy was not created");
    expect(io.getCurrent(copy.slug)).toMatchObject({ title: copy.title, "x-owner": "team" });
    expect(io.getCurrent(copy.slug)?.nodes[0].label).toBe("My edit");
    expect(io.getDiagramIdentity(copy.slug)).not.toBe(identity);
    expect(io.getDiagramIdentity(source)).toBe(identity);
    expect(io.getCurrent(source)).toEqual(original);
    expect(io.listLibrary()).toHaveLength(1);
  });
  it("preserves an explicitly chosen name instead of appending text while typing", async () => {
    const { loadExample } = await import("../examples");
    const source = "kafka-order-pipeline";
    const original = await loadExample(source);
    const copy = io.copyEditedExample(source, { ...original, title: "My system" }, io.getDiagramIdentity(source));
    expect(copy?.title).toBe("My system");
    expect(copy && io.getCurrent(copy.slug)?.title).toBe("My system");
  });
  it("keeps a cleared name as an owned Untitled diagram", async () => {
    const { loadExample } = await import("../examples");
    const source = "kafka-order-pipeline";
    const original = await loadExample(source);
    const copy = io.copyEditedExample(source, { ...original, title: "" }, io.getDiagramIdentity(source));
    expect(copy?.title).toBe(io.UNTITLED);
    expect(copy && io.getCurrent(copy.slug)?.title).toBe(io.UNTITLED);
  });
  it("leaves the original session intact if storage refuses the copy", async () => {
    const { loadExample } = await import("../examples");
    const source = "kafka-order-pipeline";
    const original = await loadExample(source);
    const identity = io.getDiagramIdentity(source);
    storage.quotaBytes = 1;
    expect(() => io.copyEditedExample(source, original, identity)).toThrow();
    expect(io.getDiagramIdentity(source)).toBe(identity);
    expect(io.getCurrent(source)).toEqual(original);
    expect(io.listLibrary()).toHaveLength(0);
  });
});

it("a pending save from an unmounted example cannot bind or follow a reopened session", async () => {
  const source = "kafka-order-pipeline";
  const original = await (await import("../examples")).loadExample(source);
  const old = io.trackDocumentSession(source);
  io.releaseExampleSaveTarget(source);
  const reopened = io.trackDocumentSession(source);
  const copy = io.copyEditedExample(source, original, io.getDiagramIdentity(source))!;
  expect(old.resolve()).toBeUndefined();
  expect(reopened.resolve()?.slug).toBe(copy.slug);
  old.dispose();
  reopened.dispose();
});

it("example-session cleanup leaves a pending promoted draft save alone", () => {
  const identity = io.getDiagramIdentity("new");
  const pending = io.trackDocumentSession("new");
  expect(io.writeAutosave("new", good, identity)).toBe(true);
  const owner = pending.resolve();
  expect(owner?.slug).toMatch(/^my-/);
  io.releaseExampleSaveTarget("new");
  expect(pending.resolve()).toEqual(owner);
  pending.dispose();
});

describe("retired examples", () => {
  const AUTOSAVE = "diagrams.autosave.v1:";
  const ENTRY = "diagrams.library-entry.v1:";
  /** Web Locks as browsers give them: one holder at a time, in request order. */
  const serialLocks = () => {
    let tail: Promise<unknown> = Promise.resolve();
    return {
      request: (_name: string, run: () => unknown) => {
        const next = tail.then(run);
        tail = next.catch(() => undefined);
        return next;
      },
    };
  };
  beforeEach(() => {
    vi.stubGlobal("navigator", { locks: serialLocks() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const failEntries = (key: string) => {
    if (key.startsWith(ENTRY)) throw new DOMException("full", "QuotaExceededError");
  };
  /** An earlier start wrote the copy's document and stopped before publishing it; the source is still there. */
  const unpublish = (slug: string) => {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key && (key === `${ENTRY}${slug}` || key.startsWith("diagrams.library.v"))) storage.removeItem(key);
    }
  };

  it("edits saved under a retired example's slug become one of your diagrams, once", async () => {
    storage.setItem(`${AUTOSAVE}aws-fanout`, JSON.stringify({ ...good, title: "My fan-out edits" }));
    storage.setItem(`${AUTOSAVE}kafka-order-pipeline`, JSON.stringify(good));
    const [slug, ...more] = await io.adoptRetiredExampleEdits();
    expect(more).toEqual([]);
    expect(io.listLibrary().map((e) => [e.slug, e.title])).toEqual([[slug, "My fan-out edits"]]);
    expect(io.getCurrent(slug)?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(storage.getItem(`${AUTOSAVE}aws-fanout`)).toBeNull();
    // A current example's legacy autosave keeps working as before.
    expect(storage.getItem(`${AUTOSAVE}kafka-order-pipeline`)).not.toBeNull();
    expect(await io.adoptRetiredExampleEdits()).toEqual([]);
  });

  it("without Web Locks the copy is made but the source is always kept", async () => {
    vi.stubGlobal("navigator", {});
    storage.setItem(`${AUTOSAVE}aws-fanout`, JSON.stringify(good));
    const [slug] = await io.adoptRetiredExampleEdits();
    expect(io.listLibrary().map((e) => e.slug)).toEqual([slug]);
    expect(storage.getItem(`${AUTOSAVE}aws-fanout`)).not.toBeNull();
    // Again: the same copy, never a second one.
    expect(await io.adoptRetiredExampleEdits()).toEqual([slug]);
    expect(io.listLibrary().map((e) => e.slug)).toEqual([slug]);
  });

  it("retired edits remain recoverable when adoption hits quota", async () => {
    const edits = { ...good, title: "My plant telemetry", nodes: [{ ...good.nodes[0], id: "kept", label: "Kept" }] };
    storage.setItem(`${AUTOSAVE}iot-telemetry`, JSON.stringify(edits));
    // The library entry can't be written: the document written before it is rolled back.
    storage.beforeWrite = failEntries;
    expect(await io.adoptRetiredExampleEdits()).toEqual([]);
    expect(io.listLibrary()).toEqual([]);
    expect(storage.getItem(`${AUTOSAVE}iot-telemetry`)).not.toBeNull();
    // The notice says why, and offers the edits as a file.
    const notice = toast.toast.current;
    expect(notice?.kind).toBe("error");
    expect(notice?.text).toMatch(/My plant telemetry/);
    expect(notice?.text).toMatch(/storage is full/);
    expect(notice?.action?.label).toBe("Download edits");
    notice?.action?.run();
    const files = await import("../interop/files");
    await vi.waitFor(() => expect(files.downloadText).toHaveBeenCalledTimes(1));
    const [text, name, mime] = vi.mocked(files.downloadText).mock.calls[0];
    expect(JSON.parse(text)).toMatchObject({ title: "My plant telemetry", nodes: [{ id: "kept", label: "Kept" }] });
    expect(name).toBe("My plant telemetry.diagram.json");
    expect(mime).toBe("application/json");
    // Once there's room, the next start adopts them.
    storage.beforeWrite = undefined;
    const [slug] = await io.adoptRetiredExampleEdits();
    expect(io.getCurrent(slug)?.title).toBe("My plant telemetry");
    expect(storage.getItem(`${AUTOSAVE}iot-telemetry`)).toBeNull();
  });

  it("several failed migrations share one notice that downloads them all", async () => {
    storage.setItem(`${AUTOSAVE}iot-telemetry`, JSON.stringify({ ...good, title: "Plant" }));
    storage.setItem(`${AUTOSAVE}aws-fanout`, JSON.stringify({ ...good, title: "Fan-out" }));
    storage.beforeWrite = failEntries;
    expect(await io.adoptRetiredExampleEdits()).toEqual([]);
    expect(toast.toast.current?.text).toMatch(/Your edits to 2 examples/);
    toast.toast.current?.action?.run();
    const files = await import("../interop/files");
    await vi.waitFor(() => expect(files.downloadText).toHaveBeenCalledTimes(2));
    expect(
      vi
        .mocked(files.downloadText)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual(["Fan-out.diagram.json", "Plant.diagram.json"]);
  });

  it("adoption repairs a document whose library publication was interrupted", async () => {
    storage.setItem(`${AUTOSAVE}keda-render-workers`, JSON.stringify(good));
    const [slug] = await io.adoptRetiredExampleEdits();
    unpublish(slug);
    storage.setItem(`${AUTOSAVE}keda-render-workers`, JSON.stringify(good));
    expect(io.listLibrary()).toEqual([]);
    expect(await io.adoptRetiredExampleEdits()).toEqual([slug]);
    expect(io.listLibrary().map((e) => e.slug)).toEqual([slug]);
    expect(io.getCurrent(slug)?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(storage.getItem(`${AUTOSAVE}keda-render-workers`)).toBeNull();
  });

  it("a half-written document is never rolled back, and the source stays when publishing fails", async () => {
    storage.setItem(`${AUTOSAVE}keda-render-workers`, JSON.stringify(good));
    const [slug] = await io.adoptRetiredExampleEdits();
    unpublish(slug);
    storage.setItem(`${AUTOSAVE}keda-render-workers`, JSON.stringify(good));
    storage.beforeWrite = failEntries;
    expect(await io.adoptRetiredExampleEdits()).toEqual([]);
    expect(io.getOriginal(slug)?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(storage.getItem(`${AUTOSAVE}keda-render-workers`)).not.toBeNull();
  });

  it("interrupted adoption preserves private provenance", async () => {
    const secret = JSON.stringify({ ...good, private: true });
    storage.setItem(`${AUTOSAVE}aws-fanout`, secret);
    const [slug] = await io.adoptRetiredExampleEdits();
    expect(io.getPrivacyFlags(slug).private).toBe(true);
    // The document was written without its `private` field, and the start stopped before publishing the entry.
    unpublish(slug);
    storage.setItem(`${AUTOSAVE}aws-fanout`, secret);
    // Watch the moment the source goes: by then the republished entry must already be Private.
    let privateWhenDeleted: boolean | undefined;
    const original = storage.removeItem;
    const remove = vi.spyOn(storage, "removeItem").mockImplementation((key: string) => {
      if (key === `${AUTOSAVE}aws-fanout`) privateWhenDeleted = io.getPrivacyFlags(slug).private;
      original(key);
    });
    expect(await io.adoptRetiredExampleEdits()).toEqual([slug]);
    remove.mockRestore();
    expect(io.getPrivacyFlags(slug).private).toBe(true);
    expect(privateWhenDeleted).toBe(true);
    expect(storage.getItem(`${AUTOSAVE}aws-fanout`)).toBeNull();
  });

  it("a copy you deleted isn't recreated from the retired edits", async () => {
    storage.setItem(`${AUTOSAVE}aws-fanout`, JSON.stringify(good));
    vi.stubGlobal("navigator", {});
    const [slug] = await io.adoptRetiredExampleEdits();
    io.deleteLibraryDiagram(slug);
    expect(await io.adoptRetiredExampleEdits()).toEqual([]);
    expect(io.listLibrary()).toEqual([]);
    expect(storage.getItem(`${AUTOSAVE}aws-fanout`)).not.toBeNull();
  });

  it("failed concurrent adoption preserves the peer's committed copy", async () => {
    storage.setItem(`${AUTOSAVE}aws-fanout`, JSON.stringify(good));
    vi.resetModules();
    const peer = await import("./diagramIO");
    // Both tabs start at once. The lock lets the peer finish first; then this tab's entry writes fail.
    const peerRun = peer.adoptRetiredExampleEdits().then((slugs) => {
      storage.beforeWrite = failEntries;
      return slugs;
    });
    const ownRun = io.adoptRetiredExampleEdits();
    const peerSlugs = await peerRun;
    expect(peerSlugs).toHaveLength(1);
    await ownRun;
    storage.beforeWrite = undefined;
    expect(io.listLibrary().map((e) => e.slug)).toEqual(peerSlugs);
    expect(io.getCurrent(peerSlugs[0])?.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(storage.getItem(`${AUTOSAVE}aws-fanout`)).toBeNull();
  });

  it("a retry after an interrupted cleanup reuses the copy", async () => {
    storage.setItem(`${AUTOSAVE}keda-render-workers`, JSON.stringify(good));
    // The copy is stored and listed, but removing the old key fails (the tab closes, or storage refuses).
    const remove = vi.spyOn(storage, "removeItem").mockImplementationOnce(() => {
      throw new Error("interrupted");
    });
    const [slug] = await io.adoptRetiredExampleEdits();
    remove.mockRestore();
    expect(storage.getItem(`${AUTOSAVE}keda-render-workers`)).not.toBeNull();
    expect(await io.adoptRetiredExampleEdits()).toEqual([slug]);
    expect(io.listLibrary().map((e) => e.slug)).toEqual([slug]);
    expect(storage.getItem(`${AUTOSAVE}keda-render-workers`)).toBeNull();
  });
});
