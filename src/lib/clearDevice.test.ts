import { describe, expect, it } from "vitest";

// Clear everything on this device: every key the app keeps goes, from local and session storage; another app's keys
// on the same origin stay. Node has no storage: Map-backed stand-ins, installed before the modules load.

class MemoryStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key = (i: number) => [...this.m.keys()][i] ?? null;
  getItem = (k: string) => this.m.get(k) ?? null;
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem = (k: string) => void this.m.delete(k);
}
const local = new MemoryStorage();
const session = new MemoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });
const io = await import("./diagramIO");
const { blockStorageWrites, clearAppStorage } = await import("./clearDevice");

describe("clearAppStorage", () => {
  it("removes the app's keys (diagrams, AI conversations, settings) and leaves other apps' keys", () => {
    const slug = io.createLibraryDiagram({
      format: "diagrams/v1",
      title: "Payroll flow",
      nodes: [{ id: "a", stencil: "kafka.topic", label: "Ledger", x: 0, y: 0 }],
      edges: [],
    });
    io.setDiagramPrivate(slug, true);
    local.setItem(`diagrams.ai-thread.v1:${io.getDiagramIdentity(slug)}`, '{"turns":[]}');
    local.setItem("diagrams.settings.v1", "{}");
    local.setItem("other-app.token", "keep");
    session.setItem("diagrams.pendingStencils.v1", "[]");
    session.setItem("other-app.state", "keep");

    expect(clearAppStorage()).toBeGreaterThanOrEqual(5);
    expect([...local.m.keys()]).toEqual(["other-app.token"]);
    expect([...session.m.keys()]).toEqual(["other-app.state"]);
    expect(io.listLibrary()).toEqual([]);
  });

  it("after Clear everything, an autosave on the way out writes nothing back", () => {
    blockStorageWrites(MemoryStorage.prototype);
    io.writeAutosave(io.DRAFT_SLUG, { format: "diagrams/v1", title: "Late edit", nodes: [], edges: [] });
    expect([...local.m.keys()].filter((k) => k.startsWith("diagrams."))).toEqual([]);
  });
});
