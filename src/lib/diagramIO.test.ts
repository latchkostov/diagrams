import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import type { FileHandle } from "../interop/files";
import { writeHandle } from "../interop/files";

// Node has no localStorage: a Map-backed stand-in (installed before diagramIO is imported).
class MemoryStorage {
  private m = new Map<string, string>();
  quotaBytes = Infinity;
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem = (k: string, v: string) => {
    if (v.length > this.quotaBytes) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  };
  removeItem = (k: string) => void this.m.delete(k);
  clear = () => this.m.clear();
}
const storage = new MemoryStorage();
(globalThis as { localStorage?: unknown }).localStorage = storage;
const io = await import("./diagramIO");

const good: DiagramFile = {
  format: "diagrams/v1",
  title: "Good",
  nodes: [{ id: "a", stencil: "kafka.topic", label: "A", x: 0, y: 0 }],
  edges: [],
};

describe("diagramIO storage goes through the shared validator", () => {
  beforeEach(() => {
    storage.clear();
    storage.quotaBytes = Infinity;
  });

  it("rejects an invalid diagram without replacing the stored import", () => {
    io.setImported(good);
    const bad = { ...good, title: "Bad", edges: [{ id: "e", from: "a", to: "ghost" }] } as DiagramFile;
    expect(() => io.setImported(bad)).toThrow(/points at a node/);
    expect(io.getImported()?.title).toBe("Good");
  });

  it("stores the repaired form of malformed groups", () => {
    io.setImported({ ...good, groups: {} } as unknown as DiagramFile);
    expect(io.getImported()?.groups).toBeUndefined();
  });

  it("treats tampered storage as missing instead of crashing the canvas", () => {
    localStorage.setItem("diagrams.imported.v1", JSON.stringify({ ...good, nodes: [{ id: "a" }] }));
    expect(io.getImported()).toBeUndefined();
    localStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", "{ not json");
    expect(io.getAutosave("kafka-order-pipeline")).toBeUndefined();
    localStorage.setItem("diagrams.autosave.v1:x", JSON.stringify({ ...good, groups: [null] }));
    expect(io.getAutosave("x")?.groups).toBeUndefined();
  });

  it("reports full storage with an actionable message and keeps the old copy", () => {
    io.setImported(good);
    storage.quotaBytes = 10;
    expect(() => io.setImported({ ...good, title: "Newer" })).toThrow(/storage .* full/);
    storage.quotaBytes = Infinity;
    expect(io.getImported()?.title).toBe("Good");
  });

  it("parseDiagram is the native validator", () => {
    expect(io.parseDiagram(JSON.stringify(good)).ok).toBe(true);
    const r = io.parseDiagram(JSON.stringify({ ...good, groups: [null] }));
    expect(r.ok && r.diagram.groups).toBeUndefined();
  });
});

describe("autosave never throws", () => {
  it("returns false when storage is full instead of crashing the canvas", () => {
    storage.quotaBytes = 10;
    expect(io.writeAutosave("x", good)).toBe(false);
    storage.quotaBytes = Infinity;
    expect(io.writeAutosave("x", good)).toBe(true);
    expect(io.getAutosave("x")?.title).toBe("Good");
  });
});

describe("document sessions", () => {
  const handle: FileHandle = {
    kind: "file",
    name: "a.json",
    getFile: async () => new File([], "a.json"),
    createWritable: vi.fn(async () => ({ write: vi.fn(), close: vi.fn() })),
  };
  beforeEach(() => {
    storage.clear();
    storage.quotaBytes = Infinity;
    vi.clearAllMocks();
  });

  it("import A, bind a handle, import B: Save cannot write to A's handle", async () => {
    io.setImported(good);
    io.bindSaveTarget("imported", { kind: "device", handle }, io.getDiagramIdentity("imported"));
    io.setImported({ ...good, title: "B" });
    const target = io.getSaveTarget("imported");
    if (target?.kind === "device") await writeHandle(target.handle, "B");
    expect(target).toBeUndefined();
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it("gallery creation clears device, Drive and autosave bindings", () => {
    vi.stubGlobal("window", new EventTarget());
    try {
      for (const target of [
        { kind: "device", handle },
        { kind: "drive", id: "a", name: "A" },
      ] as const) {
        io.setImported(good, target);
        io.writeAutosave("imported", { ...good, title: "Edited A" });
        io.createDiagram({ title: "B" });
        expect(io.getSaveTarget("imported")).toBeUndefined();
        expect(io.getAutosave("imported")).toBeUndefined();
        expect(io.getImported()?.title).toBe("B");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("publishes a supplied Drive destination in the same stored session as its diagram", () => {
    io.setImported(good, { kind: "drive", id: "a", name: "A" });
    const raw = JSON.parse(storage.getItem("diagrams.imported.v1")!);
    expect(raw).toMatchObject({ diagram: { title: "Good" }, drive: { id: "a" } });
    io.setImported({ ...good, title: "B" });
    expect(io.getSaveTarget("imported")).toBeUndefined();
    // Bindings left by an older version are never reused.
    storage.setItem("diagrams.bindings.v1", JSON.stringify({ imported: { kind: "drive", id: "a", name: "A" } }));
    expect(io.getSaveTarget("imported")).toBeUndefined();
  });

  it("failed replacement retains both the old document and its destination", () => {
    io.setImported(good, { kind: "device", handle });
    const identity = io.getDiagramIdentity("imported");
    storage.quotaBytes = 10;
    expect(() => io.setImported({ ...good, title: "B" })).toThrow(/storage/);
    storage.quotaBytes = Infinity;
    expect(io.getDiagramIdentity("imported")).toBe(identity);
    expect(io.getSaveTarget("imported")).toEqual({ kind: "device", handle });
    expect(io.getImported()?.title).toBe("Good");
  });

  it("a late Save As result cannot bind to a replacement document", () => {
    io.setImported(good);
    const identity = io.getDiagramIdentity("imported");
    io.setImported({ ...good, title: "B" });
    expect(io.bindSaveTarget("imported", { kind: "device", handle }, identity)).toBe(false);
    expect(io.getSaveTarget("imported")).toBeUndefined();
  });

  it("unrelated slot changes preserve the open document identity", () => {
    io.setImported(good);
    const imported = io.getDiagramIdentity("imported");
    const example = io.getDiagramIdentity("kafka-order-pipeline");
    io.setShared(good);
    expect(io.getDiagramIdentity("imported")).toBe(imported);
    expect(io.getDiagramIdentity("kafka-order-pipeline")).toBe(example);
  });

  it("stale autosave cannot hide a replacement even when removal fails", () => {
    io.setImported(good);
    io.writeAutosave("imported", good);
    const remove = vi.spyOn(storage, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      io.setImported({ ...good, title: "B" });
      expect(io.getAutosave("imported")).toBeUndefined();
      expect(io.getImported()?.title).toBe("B");
    } finally {
      remove.mockRestore();
    }
  });
});

it("storage reload retains a simulation after its referenced node is deleted", () => {
  storage.quotaBytes = Infinity;
  const simulation = {
    id: "s",
    title: "S",
    traffic: [{ id: "t", node: "deleted", shape: { kind: "burst", count: 1 } as const }],
  };
  io.setImported({ ...good, simulations: [simulation] });
  expect(io.getImported()?.simulations).toEqual([simulation]);
  io.writeAutosave("imported", { ...good, simulations: [simulation] });
  expect(io.getAutosave("imported")?.simulations).toEqual([simulation]);
});

it("preserves legacy slot autosaves during upgrade without restoring their unsafe save target", () => {
  storage.quotaBytes = Infinity;
  storage.setItem("diagrams.imported.v1", JSON.stringify(good));
  storage.setItem("diagrams.autosave.v1:imported", JSON.stringify({ ...good, title: "Legacy edit" }));
  expect(io.getAutosave("imported")?.title).toBe("Legacy edit");
});

it("legacy diagram extension fields cannot masquerade as a document session or save binding", () => {
  storage.quotaBytes = Infinity;
  const extended = {
    ...good,
    sessionId: "extension",
    diagram: { ...good, title: "Nested extension" },
    drive: { kind: "drive", id: "wrong", name: "Wrong" },
  };
  storage.setItem("diagrams.imported.v1", JSON.stringify(extended));
  expect(io.getImported()?.title).toBe("Good");
  expect(io.getSaveTarget("imported")).toBeUndefined();
});

it("the first explicit Save upgrades a legacy slot without remounting it or discarding its autosave", () => {
  storage.quotaBytes = Infinity;
  storage.setItem("diagrams.imported.v1", JSON.stringify(good));
  storage.setItem("diagrams.autosave.v1:imported", JSON.stringify({ ...good, title: "Legacy edit" }));
  const identity = io.getDiagramIdentity("imported");
  expect(io.bindSaveTarget("imported", { kind: "drive", id: "explicit", name: "Saved" }, identity)).toBe(true);
  expect(io.getDiagramIdentity("imported")).toBe(identity);
  expect(io.getSaveTarget("imported")).toEqual({ kind: "drive", id: "explicit", name: "Saved" });
  expect(io.getAutosave("imported")?.title).toBe("Legacy edit");
});

it("creates document identities when randomUUID is unavailable on an HTTP deployment", () => {
  storage.quotaBytes = Infinity;
  vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
  try {
    io.setImported(good);
    const identity = io.getDiagramIdentity("imported");
    expect(identity).toMatch(/^[0-9a-f]{32}$/);
    io.setImported(good);
    expect(io.getDiagramIdentity("imported")).not.toBe(identity);
  } finally {
    vi.unstubAllGlobals();
  }
});
