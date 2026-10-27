import { beforeEach, describe, expect, it, vi } from "vitest";

// The "now private" toast offers Clear conversation whenever the diagram has one: the conversation store's view,
// so one kept only in memory (storage full or blocked) counts as well as a stored one.

const notify = vi.fn();
const attach = vi.fn();
vi.mock("../../interop/ui/toast", () => ({
  notify: (...args: unknown[]) => notify(...args),
  toast: { attach: (...args: unknown[]) => attach(...args) },
}));

// Storage that refuses every write, as a full one does: the store keeps conversations in memory only.
const full = {
  getItem: () => null,
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
  removeItem: () => {},
};
vi.stubGlobal("localStorage", full);

const { threads } = await import("./threadStore");
const { offerToClearConversation } = await import("./clearOnPrivate");

beforeEach(() => {
  notify.mockClear();
  attach.mockClear();
});

describe("offerToClearConversation", () => {
  it("offers to clear a conversation kept only in memory, and clearing has Undo", () => {
    threads.append("doc-a", { kind: "change", request: "Add the payroll ledger", changed: [] });
    expect(threads.get("doc-a")).toHaveLength(1);
    offerToClearConversation("doc-a", 7, () => true);
    // The "now private" notification itself, by id: wherever it is by now (showing, or waiting).
    const [id, action] = attach.mock.calls[0] as [number, { label: string; run: () => void }];
    expect(id).toBe(7);
    expect(action.label).toBe("Clear conversation");
    action.run();
    expect(threads.get("doc-a")).toEqual([]);
    const [, undo] = notify.mock.calls[0] as [string, { action: { label: string; run: () => void } }];
    undo.action.run();
    expect(threads.get("doc-a")).toHaveLength(1);
  });

  it("offers nothing once the person has moved on (another diagram, or not private)", () => {
    threads.append("doc-c", { kind: "change", request: "Add the payroll ledger", changed: [] });
    offerToClearConversation("doc-c", 7, () => false);
    expect(attach).not.toHaveBeenCalled();
  });

  it("offers nothing for a diagram with no conversation", () => {
    offerToClearConversation("doc-b", 7, () => true);
    expect(attach).not.toHaveBeenCalled();
  });
});
