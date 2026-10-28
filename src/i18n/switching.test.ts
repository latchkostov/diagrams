import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_KEY, state } from "./index";
import { chooseLocale, chosenLocale } from "./load";

// Switching languages when downloads are slow or fail (./load.ts): the language on screen and the stored choice
// change together, only once the catalog is in, and only for the latest choice. Catalogs here are deferred by hand,
// so the order they arrive in is the test's, not the network's.

const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
vi.mock("virtual:i18n/catalogs", () => {
  const deferred = (code: string) => () =>
    new Promise<{ default: Record<string, string> }>((resolve, reject) =>
      pending.set(code, { resolve: () => resolve({ default: { "New diagram": `[${code}]` } }), reject }),
    );
  return {
    coreCatalogs: { de: deferred("de"), ja: deferred("ja"), bg: deferred("bg") },
    surfaceCatalogs: {},
    reviewed: [],
  };
});

const stored = new Map<string, string>();
const root = { lang: "en", dir: "ltr" };
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  stored.clear();
  pending.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
    removeItem: (k: string) => void stored.delete(k),
  });
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("navigator", { languages: ["en-US"], language: "en-US" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(state, { l: "en", c: undefined, a: undefined });
  Object.assign(root, { lang: "en", dir: "ltr" });
});

describe("switching languages", () => {
  it("commits nothing until the catalog is in", async () => {
    const done = chooseLocale("de");
    await settle();
    expect(state.l).toBe("en");
    expect(stored.has(LOCALE_KEY)).toBe(false);
    pending.get("de")!.resolve();
    expect(await done).toBe(true);
    expect([state.l, root.lang, stored.get(LOCALE_KEY)]).toEqual(["de", "de", "de"]);
  });

  it("a failed download changes nothing and says so; the retry works", async () => {
    const failing = chooseLocale("de");
    await settle();
    pending.get("de")!.reject(new Error("offline"));
    await expect(failing).rejects.toThrow("offline");
    expect(state.l).toBe("en");
    expect(chosenLocale()).toBeNull();
    const retry = chooseLocale("de");
    await settle();
    pending.get("de")!.resolve();
    expect(await retry).toBe(true);
    expect(chosenLocale()).toBe("de");
  });

  it("the latest choice wins, whichever download finishes first", async () => {
    // Japanese, then Bulgarian; Bulgarian arrives first, Japanese after.
    const first = chooseLocale("ja");
    const second = chooseLocale("bg");
    await settle();
    pending.get("bg")!.resolve();
    expect(await second).toBe(true);
    pending.get("ja")!.resolve();
    expect(await first).toBe(false);
    expect([state.l, root.lang, stored.get(LOCALE_KEY)]).toEqual(["bg", "bg", "bg"]);
  });

  it("an older download can't overwrite a later English choice", async () => {
    const german = chooseLocale("de");
    await settle();
    // English needs no download: it's on at once.
    expect(await chooseLocale("en")).toBe(true);
    pending.get("de")!.resolve();
    expect(await german).toBe(false);
    expect([state.l, state.c, root.lang, root.dir, stored.get(LOCALE_KEY)]).toEqual([
      "en",
      undefined,
      "en",
      "ltr",
      "en",
    ]);
  });

  it("a superseded download that fails is ignored", async () => {
    const german = chooseLocale("de");
    await settle();
    expect(await chooseLocale("en")).toBe(true);
    pending.get("de")!.reject(new Error("offline"));
    expect(await german).toBe(false);
    expect(state.l).toBe("en");
  });
});
