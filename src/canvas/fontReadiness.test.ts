import { afterEach, expect, it, vi } from "vitest";
import { createFontReadiness } from "./fontReadiness";

afterEach(() => vi.unstubAllGlobals());

it("scans text/fonts once across position fits, refreshing after text or typography changes", async () => {
  const load = vi.fn(async () => []);
  vi.stubGlobal("document", { fonts: { load, ready: Promise.resolve() } });
  vi.stubGlobal("Node", { TEXT_NODE: 3 });
  const computed = vi.fn(() => ({ fontStyle: "normal", fontWeight: "400", fontSize: "16px", fontFamily: "Test" }));
  vi.stubGlobal("getComputedStyle", computed);
  const text = { nodeType: 3, textContent: "A caption" };
  const scan = vi.fn(() => []);
  const root = {
    childNodes: [text],
    querySelectorAll: scan,
    get textContent() {
      return text.textContent;
    },
  } as unknown as HTMLElement;
  const caption = { textSize: "normal" };
  const cache = createFontReadiness();
  await cache.ready(root, ["light:cards:en", caption]);
  for (let move = 0; move < 60; move++) {
    // New positions and input arrays, identical rendered data and text.
    await cache.ready(root, ["light:cards:en", caption]);
  }
  expect(scan).toHaveBeenCalledTimes(1);
  expect(computed).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledTimes(1);
  text.textContent = "Changed caption";
  await cache.ready(root, ["light:cards:en", caption]);
  expect(load).toHaveBeenLastCalledWith("normal 400 16px Test", "Changed caption");
  expect(scan).toHaveBeenCalledTimes(2);
  const largerCaption = { textSize: "large" };
  await cache.ready(root, ["light:cards:en", largerCaption]);
  expect(scan).toHaveBeenCalledTimes(3);
  await cache.ready(root, ["dark:compact:fr", largerCaption]);
  expect(scan).toHaveBeenCalledTimes(4);
  cache.invalidate();
  await cache.ready(root, ["dark:compact:fr", largerCaption]);
  expect(scan).toHaveBeenCalledTimes(5);
});
