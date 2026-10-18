import { expect, it } from "vitest";
import { markdownImageSource } from "./imagePolicy";

it("allows only the app CSP image capabilities; the offline viewer has no self origin", () => {
  const origin = "https://livediagrams.dev";
  for (const source of ["data:image/png;base64,AA==", "blob:https://livediagrams.dev/id"]) {
    expect(markdownImageSource(source, false, origin)).toBe(source);
    expect(markdownImageSource(source, true, origin)).toBe(source);
  }
  for (const source of ["/favicon.svg", "./arch.png", origin + "/arch.png"]) {
    expect(markdownImageSource(source, false, origin)).toBe(new URL(source, origin).href);
    expect(markdownImageSource(source, true, origin)).toBeUndefined();
  }
  for (const source of [
    "//example.com/a.png",
    "https://example.com/a.png",
    "javascript:alert(1)",
    "data:text/html,evil",
  ]) {
    expect(markdownImageSource(source, false, origin)).toBeUndefined();
  }
});
