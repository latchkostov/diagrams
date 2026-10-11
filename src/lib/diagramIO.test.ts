import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { SaveTarget } from "./diagramIO";
import type { FileHandle } from "../interop/files";
import { writeHandle } from "../interop/files";

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
const io = await import("./diagramIO");
const toast = await import("../interop/ui/toast");

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

beforeEach(() => {
  storage.clear();
  storage.quotaBytes = Infinity;
  storage.failKey = undefined;
  storage.beforeWrite = undefined;
  vi.clearAllMocks();
});

describe("diagramIO storage goes through the shared validator", () => {
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
