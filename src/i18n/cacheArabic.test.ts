import { expect, it } from "vitest";
import en from "./en";
import ar from "./locales/ar.json";

it("translates the caching learning path as a complete Arabic batch", () => {
  for (const [key, english] of Object.entries(en).filter(
    ([key]) => key.startsWith("cache.") || key === "tutorials.cdnCache.finish" || key === "tutorials.cdnCache.guidance",
  )) {
    const translated = ar[key as keyof typeof ar];
    expect(translated, key).toBeTruthy();
    // The protected SI unit is shared; learning prose must have an Arabic translation.
    if (key !== "cache.milliseconds") expect(translated, key).not.toBe(english);
    for (const token of english.matchAll(/\{(name|node|origin|rule|ttl|match|step)\}/g)) {
      expect(translated, `${key}/${token[1]}`).toContain(`\u2068{${token[1]}}\u2069`);
    }
  }
  expect(ar["cache.summary"]).toContain("\u2068{hit}%\u2069");
  expect(ar["cache.summary"]).toContain("\u2068{offload}%\u2069");
  expect(ar["cache.keepFor"]).toBe("الاحتفاظ لمدة");
  expect(ar["cache.expected"]).toContain("المتوقع");
});
