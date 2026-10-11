import { describe, expect, it } from "vitest";
import { createSafeStorage } from "./storage";

describe("safe storage", () => {
  it("handles blocked getters without exposing their errors", () => {
    const storage = createSafeStorage(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(storage.getItem("key")).toBeNull();
    expect(storage.setItem("key", "value")).toBe(false);
    expect(storage.removeItem("key")).toBe(false);
  });
  it("reports unavailable writes and removals, and recovers on the next attempt", () => {
    let full = true;
    const values = new Map<string, string>();
    const storage = createSafeStorage(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (full) throw new DOMException("Full", "QuotaExceededError");
        values.set(key, value);
      },
      removeItem: (key) => {
        if (full) throw new Error("Blocked");
        values.delete(key);
      },
    }));
    expect(storage.setItem("key", "value")).toBe(false);
    expect(storage.removeItem("key")).toBe(false);
    full = false;
    expect(storage.setItem("key", "value")).toBe(true);
    expect(storage.getItem("key")).toBe("value");
    expect(storage.removeItem("key")).toBe(true);
    expect(storage.getItem("key")).toBeNull();
  });
});
