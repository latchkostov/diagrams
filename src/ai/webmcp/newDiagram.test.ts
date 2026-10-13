import { describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { openNewDiagram, type NewDiagramHost } from "./newDiagram";

// new_diagram writes the agent's title only into the diagram it opened, and only while AI may change it.

const fakeEditor = () => ({ updateMeta: vi.fn() }) as unknown as EditorApi & { updateMeta: ReturnType<typeof vi.fn> };

function host(opts: { next?: EditorApi | null; ai?: boolean } = {}) {
  const before = fakeEditor();
  let current: EditorApi | null = before;
  const listeners = new Set<() => void>();
  const h: NewDiagramHost = {
    currentEditor: () => current,
    canUseAi: () => opts.ai ?? true,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    open: () => {
      if (opts.next === undefined) return;
      current = opts.next;
      for (const l of [...listeners]) l();
    },
    settle: async () => {},
  };
  return { h, before };
}

describe("openNewDiagram", () => {
  it("titles the new diagram", async () => {
    const next = fakeEditor();
    const { h, before } = host({ next });
    expect(await openNewDiagram(h, { title: "Orders" })).toBe(next);
    expect(next.updateMeta).toHaveBeenCalledWith({ title: "Orders" });
    expect((before as ReturnType<typeof fakeEditor>).updateMeta).not.toHaveBeenCalled();
  });

  it("never writes into a new diagram that starts private", async () => {
    const next = fakeEditor();
    const { h } = host({ next, ai: false });
    expect(await openNewDiagram(h, { title: "Orders", direction: "TB" })).toBe(next);
    expect(next.updateMeta).not.toHaveBeenCalled();
  });

  it("never renames the diagram that was open when no new one comes", async () => {
    vi.useFakeTimers();
    try {
      const { h, before } = host();
      const done = openNewDiagram(h, { title: "Orders" }, 50);
      await vi.advanceTimersByTimeAsync(60);
      expect(await done).toBeNull();
      expect((before as ReturnType<typeof fakeEditor>).updateMeta).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
