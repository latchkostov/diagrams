import { beforeEach, describe, expect, it } from "vitest";
import type { DiagramFile } from "../model/types";

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
