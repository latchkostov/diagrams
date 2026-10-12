import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, MERGE_WINDOW_MS, present, redo, undo } from "./history";

const entry = (key: string, at = 0, mergeKey?: string) => ({ key, value: key, at, mergeKey });

describe("history", () => {
  it("starts a new coalescing sequence after undo or redo", () => {
    let h = commit(createHistory("original", "original"), entry("A", 100, "label"));
    h = commit(h, entry("other", 200, "position"));
    h = commit(undo(h), entry("B", 300, "label"));
    expect(present(undo(h)).value).toBe("A");
    h = commit(redo(undo(h)), entry("C", 400, "label"));
    expect(present(undo(h)).value).toBe("B");
  });
  it("commits, undoes and redoes", () => {
    let h = createHistory("a", "a");
    h = commit(h, entry("b"));
    h = commit(h, entry("c"));
    expect(present(h).value).toBe("c");
    h = undo(h);
    expect(present(h).value).toBe("b");
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(present(h).value).toBe("c");
    expect(canRedo(h)).toBe(false);
  });

  it("ignores commits identical to the present", () => {
    const h = commit(createHistory("a", "a"), entry("b"));
    expect(commit(h, entry("b"))).toBe(h);
  });

  it("drops the redo branch on a new commit", () => {
    let h = commit(commit(createHistory("a", "a"), entry("b")), entry("c"));
    h = undo(undo(h));
    h = commit(h, entry("x"));
    expect(h.entries.map((e) => e.key)).toEqual(["a", "x"]);
    expect(canRedo(h)).toBe(false);
  });

  it("undo / redo are no-ops at the ends", () => {
    const h = createHistory("a", "a");
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("merges same-tag commits inside the window", () => {
    let h = createHistory("", "");
    h = commit(h, entry("O", 1000, "label"));
    h = commit(h, entry("Or", 1500, "label"));
    h = commit(h, entry("Ord", 2000, "label"));
    expect(h.entries.map((e) => e.key)).toEqual(["", "Ord"]);
    // Outside the window: a new step.
    h = commit(h, entry("Orde", 2000 + MERGE_WINDOW_MS + 1, "label"));
    expect(h.entries).toHaveLength(3);
    // Different tag: a new step.
    h = commit(h, entry("Order", 2000 + MERGE_WINDOW_MS + 2, "sublabel"));
    expect(h.entries).toHaveLength(4);
    expect(present(undo(h)).key).toBe("Orde");
  });

  it("a merged commit keeps the start of the step it joins", () => {
    let h = createHistory<string, string>("", "");
    h = commit(h, { ...entry("node", 1000, "add:n"), start: "before the add" });
    h = commit(h, { ...entry("node named", 1500, "add:n"), start: "the new node" });
    expect(h.entries).toHaveLength(2);
    expect(present(h)).toMatchObject({ key: "node named", start: "before the add" });
    // A new step starts from its own.
    h = commit(h, { ...entry("moved", 1600), start: "the new node" });
    expect(present(h).start).toBe("the new node");
  });

  it("never merges into the initial entry", () => {
    let h = createHistory("a", "a", 0);
    h = { ...h, entries: [{ ...h.entries[0], mergeKey: "x" }] };
    h = commit(h, entry("b", 10, "x"));
    expect(h.entries.map((e) => e.key)).toEqual(["a", "b"]);
  });

  it("caps the number of entries", () => {
    let h = createHistory("0", "0");
    for (let i = 1; i <= 12; i++) h = commit(h, entry(String(i)), 5);
    expect(h.entries.map((e) => e.key)).toEqual(["8", "9", "10", "11", "12"]);
    expect(h.index).toBe(4);
    expect(present(h).key).toBe("12");
  });
});
