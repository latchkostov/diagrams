import { describe, expect, it, vi } from "vitest";
import type { EditorApi } from "../../editor/types";
import { openNewDiagram, type NewDiagramHost } from "./newDiagram";

// new_diagram writes the agent's title only into the diagram it opened, and only while AI may change it.

const fakeEditor = () => ({ updateMeta: vi.fn() }) as unknown as EditorApi & { updateMeta: ReturnType<typeof vi.fn> };

function host(opts: { next?: EditorApi | null; ai?: boolean; settle?: () => Promise<void> } = {}) {
  const before = fakeEditor();
  let current: EditorApi | null = before;
  /** Each editor's document; another diagram opening is another document. */
  const docs = new Map<EditorApi | null, string>([[before, "before"]]);
  const listeners = new Set<() => void>();
  const h: NewDiagramHost = {
    currentEditor: () => current,
    canUseAi: () => opts.ai ?? true,
    documentId: () => docs.get(current) ?? "unknown",
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    open: () => {
      if (opts.next === undefined) return;
      current = opts.next;
      docs.set(opts.next, "new");
      for (const l of [...listeners]) l();
    },
    settle: opts.settle ?? (async () => {}),
  };
  /** Another diagram opens (the person picks one). */
  const switchTo = (editor: EditorApi, doc: string) => {
    docs.set(editor, doc);
    current = editor;
  };
  return { h, before, switchTo };
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

  it("never claims a diagram that replaced the new one while its title landed", async () => {
    let settled!: () => void;
    const next = fakeEditor();
    const { h, switchTo } = host({ next, settle: () => new Promise<void>((r) => (settled = r)) });
    const done = openNewDiagram(h, { title: "Orders" });
    await vi.waitFor(() => expect(next.updateMeta).toHaveBeenCalled());
    switchTo(fakeEditor(), "someone-elses");
    settled();
    expect(await done).toBeNull();
  });

  it("a draft that becomes an entry while its title lands is still the new diagram", async () => {
    let settled!: () => void;
    const next = fakeEditor();
    const { h, switchTo } = host({ next, settle: () => new Promise<void>((r) => (settled = r)) });
    const done = openNewDiagram(h, { title: "Orders" });
    await vi.waitFor(() => expect(next.updateMeta).toHaveBeenCalled());
    const promoted = fakeEditor();
    switchTo(promoted, "new");
    settled();
    expect(await done).toBe(promoted);
  });
});
