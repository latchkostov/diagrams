import { describe, expect, it, vi } from "vitest";
import { railLabel, unseen } from "./unseen";

describe("unseen agent changes", () => {
  it("counts per diagram and clears one diagram at a time", () => {
    const heard = vi.fn();
    const off = unseen.subscribe(heard);
    unseen.bump("a");
    unseen.bump("a");
    unseen.bump("b");
    expect(unseen.get("a")).toBe(2);
    expect(unseen.get("b")).toBe(1);
    unseen.clear("a");
    expect(unseen.get("a")).toBe(0);
    expect(unseen.get("b")).toBe(1);
    expect(heard).toHaveBeenCalledTimes(4);
    // Clearing nothing tells no one.
    unseen.clear("a");
    expect(heard).toHaveBeenCalledTimes(4);
    off();
    unseen.clear("b");
  });

  it("copies the count without changing the source document", () => {
    unseen.bump("source");
    unseen.copy("source", "copy");
    expect(unseen.get("copy")).toBe(1);
    unseen.clear("copy");
    expect(unseen.get("source")).toBe(1);
    unseen.clear("source");
  });

  it("names the rail button with the count", () => {
    expect(railLabel(0)).toBe("AI panel");
    expect(railLabel(1)).toBe("AI panel, 1 new change");
    expect(railLabel(3)).toBe("AI panel, 3 new changes");
  });
});
