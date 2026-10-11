import { describe, expect, it } from "vitest";
import { forgetLegacyAiKeys, LEGACY_AI_KEYS } from "./legacy";

describe("forgetLegacyAiKeys", () => {
  it("removes a stored provider, model and key, and leaves everything else", () => {
    const store = new Map<string, string>([
      ["diagrams.ai-model.v1", JSON.stringify({ provider: "x", model: "y", key: "secret" })],
      ["diagrams.settings.v1", "{}"],
    ]);
    forgetLegacyAiKeys({ removeItem: (k: string) => void store.delete(k) });
    expect([...store.keys()]).toEqual(["diagrams.settings.v1"]);
    expect(LEGACY_AI_KEYS).toContain("diagrams.ai-model.v1");
  });

  it("never throws when storage is blocked or missing", () => {
    expect(() =>
      forgetLegacyAiKeys({
        removeItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
    expect(() => forgetLegacyAiKeys(null)).not.toThrow();
    // Blocked storage throws on access itself, not just on use.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      expect(() => forgetLegacyAiKeys()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
