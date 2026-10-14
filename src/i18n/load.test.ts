import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALE_KEY, state, t } from "./index";
import {
  available,
  browserLocale,
  chooseLocale,
  chosenLocale,
  isRtl,
  languageName,
  relativeAgo,
  resolveLocale,
  setLocale,
  start,
  suggestUrl,
} from "./load";
import { formatAgo } from "./format";

// Choosing the language (./load.ts): the browser's preferences resolved the way operating systems fall back, the
// person's choice kept in this browser, and the switch itself.

const OFFERED = ["en", "bg", "de", "pt-BR", "pt-PT", "sr-Latn", "zh-CN", "zh-TW", "nb", "ar"];

describe("resolving the browser's languages", () => {
  const resolve = (...prefs: string[]) => resolveLocale(prefs, OFFERED);

  it("exact, then the same language and script, then the next preference, then the default", () => {
    expect(resolve("pt-BR")).toBe("pt-BR");
    expect(resolve("de-AT", "en")).toBe("de");
    expect(resolve("de-CH")).toBe("de");
    expect(resolve("sw", "fr", "bg-BG")).toBe("bg");
    expect(resolve("sw", "fr")).toBe("en");
    expect(resolve()).toBe("en");
  });

  it("pt-BR → pt → en: Portuguese without a region reads Brazilian, elsewhere European", () => {
    expect(resolve("pt")).toBe("pt-BR");
    expect(resolve("pt-PT")).toBe("pt-PT");
    expect(resolve("pt-AO")).toBe("pt-PT");
    expect(resolve("pt-MZ")).toBe("pt-PT");
    expect(resolveLocale(["pt-BR"], ["en", "pt-PT"])).toBe("pt-PT");
  });

  it("Chinese by script: Hong Kong and Macau read Traditional, Singapore Simplified", () => {
    expect(resolve("zh")).toBe("zh-CN");
    expect(resolve("zh-HK")).toBe("zh-TW");
    expect(resolve("zh-MO")).toBe("zh-TW");
    expect(resolve("zh-Hant")).toBe("zh-TW");
    expect(resolve("zh-SG")).toBe("zh-CN");
  });

  it("Serbian in Cyrillic reads the Latin catalog; Norwegian no and nn read Bokmål", () => {
    expect(resolve("sr")).toBe("sr-Latn");
    expect(resolve("sr-Cyrl-RS")).toBe("sr-Latn");
    expect(resolve("no")).toBe("nb");
    expect(resolve("nn-NO")).toBe("nb");
  });

  it("a copy limited to some languages falls back to its first", () => {
    expect(resolveLocale(["fr"], ["de", "en"])).toBe("de");
  });

  it("ignores malformed tags", () => {
    expect(resolve("not a tag", "de")).toBe("de");
  });
});

describe("the choice, and switching", () => {
  const stored = new Map<string, string>();
  const root = { lang: "en", dir: "ltr" };

  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => void stored.set(k, v),
      removeItem: (k: string) => void stored.delete(k),
    });
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("navigator", { languages: ["de-DE", "en"], language: "de-DE" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    state.l = "en";
    state.c = undefined;
    state.a = undefined;
  });

  it("offers English and every catalog (the pseudo-locale too, in development)", () => {
    expect(available[0]).toBe("en");
    expect(available).toEqual(expect.arrayContaining(["bg", "de", "ja", "ar", "pt-BR", "en-XA"]));
  });

  it("starts in the browser's language, sets <html lang dir>, and translates", async () => {
    expect(browserLocale()).toBe("de");
    await start();
    expect(state.l).toBe("de");
    expect(root).toEqual({ lang: "de", dir: "ltr" });
    expect(t("file.new")).not.toBe("New diagram");
  });

  it("remembers a choice in this browser; Browser default forgets it", async () => {
    await chooseLocale("ar");
    expect(stored.get(LOCALE_KEY)).toBe("ar");
    expect(chosenLocale()).toBe("ar");
    expect(root).toEqual({ lang: "ar", dir: "rtl" });
    await chooseLocale(null);
    expect(stored.has(LOCALE_KEY)).toBe(false);
    expect(chosenLocale()).toBeNull();
    expect(state.l).toBe("de");
    expect(root.dir).toBe("ltr");
  });

  it("a stored language this copy doesn't offer is ignored", () => {
    stored.set(LOCALE_KEY, "xx");
    expect(chosenLocale()).toBeNull();
  });

  it("the latest of two overlapping switches wins", async () => {
    await Promise.all([chooseLocale("ja"), chooseLocale("bg")]);
    expect(state.l).toBe("bg");
  });

  it("re-renders what subscribed", () => {
    let renders = 0;
    const listener = () => renders++;
    state.f.add(listener);
    setLocale("de");
    setLocale("en");
    state.f.delete(listener);
    expect(renders).toBe(2);
  });

  it("relative times in the language; English keeps the app's own words", () => {
    const now = Date.UTC(2026, 9, 13, 12);
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5 min ago");
    state.a = relativeAgo("de");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("vor 5 Min.");
    expect(formatAgo(now - 30 * 60 * 60_000, now)).toBe("gestern");
    expect(formatAgo(now - 10_000, now)).toBe("jetzt");
  });
});

describe("names and links", () => {
  it("names a language in itself, or in another, starting with a capital", () => {
    expect(languageName("de")).toBe("Deutsch");
    expect(languageName("bg")).toBe("Български");
    expect(languageName("fr")).toBe("Français");
    expect(languageName("de", "fr")).toBe("Allemand");
    expect(languageName("zh-CN", "en")).toMatch(/Chinese.*Simplified/);
    expect(languageName("zh-TW", "en")).toMatch(/Chinese.*Traditional/);
  });

  it("right to left: Arabic, Hebrew, Persian, Urdu", () => {
    expect(["ar", "he", "fa", "ur", "de", "en"].map(isRtl)).toEqual([true, true, true, true, false, false]);
  });

  it("a correction goes to a prefilled GitHub issue, no account beyond GitHub's", () => {
    const url = new URL(suggestUrl("bg"));
    expect(url.origin + url.pathname).toBe("https://github.com/latchkostov/diagrams/issues/new");
    expect(url.searchParams.get("title")).toBe("Translation (Bulgarian, bg): ");
    expect(url.searchParams.get("labels")).toBe("translation");
    expect(url.searchParams.get("body")).toContain("What it should say:");
  });
});
