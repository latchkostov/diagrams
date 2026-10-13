import { beforeEach, describe, expect, it, vi } from "vitest";

// Clear everything on this device and the storage generation (./storage.ts, ./clearDevice.ts). Node has no browser:
// Map-backed storages and a stub window, installed before each fresh import of the modules.

class MemoryStorage {
  m = new Map<string, string>();
  /** Characters the store holds at most, as a browser's quota. */
  quota = Infinity;
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = k.length + v.length;
    for (const [key, value] of this.m) if (key !== k) used += key.length + value.length;
    if (used > this.quota) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let local: MemoryStorage;
let session: MemoryStorage;
let win: {
  location: { reload: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn>; pathname: string };
  addEventListener: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetModules();
  local = new MemoryStorage();
  session = new MemoryStorage();
  win = { location: { reload: vi.fn(), replace: vi.fn(), pathname: "/" }, addEventListener: vi.fn() };
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("window", win);
  vi.stubGlobal("BroadcastChannel", undefined);
});

describe("a tab from before Clear everything", () => {
  it("writes nothing once the generation has changed: it drops its own session keys and reloads", async () => {
    local.setItem("diagrams.generation", "first");
    const { safeStorage, startStorageLifecycle } = await import("./storage");
    startStorageLifecycle();
    session.setItem("diagrams.pendingStencils.v1", "[]");
    session.setItem("other-app.state", "keep");
    expect(safeStorage.setItem("diagrams.settings.v1", "{}")).toBe(true);
    expect(local.getItem("diagrams.settings.v1")).toBe("{}");

    // Another tab cleared everything, and the person has since made something new there.
    local.m.clear();
    local.setItem("diagrams.generation", "second");
    local.setItem("diagrams.doc.v1:new", "new work");
    safeStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", "late words");
    safeStorage.removeItem("diagrams.doc.v1:new");
    expect(local.getItem("diagrams.autosave.v1:kafka-order-pipeline")).toBeNull();
    expect(local.getItem("diagrams.doc.v1:new")).toBe("new work");
    expect([...session.m.keys()]).toEqual(["other-app.state"]);
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe("outside the app (the exported HTML viewer)", () => {
  it("storage never reloads the page or listens for wipes: only the app joins the lifecycle", async () => {
    local.setItem("diagrams.generation", "first");
    const { safeStorage } = await import("./storage");
    local.setItem("diagrams.generation", "second");
    safeStorage.setItem("diagrams.settings.v1", "{}");
    expect(local.getItem("diagrams.settings.v1")).toBe("{}");
    expect(win.location.reload).not.toHaveBeenCalled();
    expect(win.addEventListener).not.toHaveBeenCalled();
  });
});

describe("clearDevice", () => {
  it("deletes the app's keys, leaves other apps', and starts a new generation", async () => {
    local.setItem("diagrams.doc.v1:a", "Payroll ledger");
    local.setItem("diagrams.ai-thread.v1:x", "Payroll ledger");
    local.setItem("other-app.token", "keep");
    session.setItem("diagrams.pendingStencils.v1", "[]");
    session.setItem("other-app.state", "keep");
    const { clearDevice } = await import("./clearDevice");
    clearDevice();
    expect([...local.m.keys()].sort()).toEqual(["diagrams.generation", "other-app.token"]);
    expect([...session.m.keys()]).toEqual(["other-app.state"]);
    expect(win.location.replace).toHaveBeenCalledWith("/");
  });

  it("reaches the other tabs when storage is full: the space it frees first takes the new generation", async () => {
    local.setItem("diagrams.doc.v1:a", "x".repeat(200));
    local.quota = local.getItem("diagrams.doc.v1:a")!.length + "diagrams.doc.v1:a".length;
    const { clearDevice } = await import("./clearDevice");
    clearDevice();
    expect(local.getItem("diagrams.generation")).not.toBeNull();
  });

  it("this tab writes nothing on the way out (its autosave at pagehide)", async () => {
    const { clearDevice } = await import("./clearDevice");
    const { safeStorage } = await import("./storage");
    clearDevice();
    safeStorage.setItem("diagrams.autosave.v1:kafka-order-pipeline", "late words");
    expect(local.getItem("diagrams.autosave.v1:kafka-order-pipeline")).toBeNull();
  });
});
