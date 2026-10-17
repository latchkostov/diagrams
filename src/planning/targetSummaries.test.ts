import { afterEach, expect, it, vi } from "vitest";
import { createTargetSummaries } from "./targetSummaries";

afterEach(() => vi.unstubAllGlobals());

it("batches 256 full-label reads before writes and resizes without geometry reads or redundant writes", async () => {
  let dirty = false,
    forced = 0,
    reads = 0,
    writes = 0;
  const read = () => {
    reads++;
    if (dirty) forced++;
    dirty = false;
    return 80;
  };
  let resize!: ResizeObserverCallback;
  const unobserve = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve = unobserve;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("document", {
    createRange: () => {
      let selected: HTMLElement;
      return {
        selectNodeContents(span: HTMLElement) {
          selected = span;
        },
        getBoundingClientRect: () => ({ width: read() * (selected.textContent === "Orders, Orders canary" ? 2 : 1) }),
      };
    },
  });
  const spans = Array.from({ length: 256 }, () => {
    let text = "Orders, Orders canary";
    return {
      get clientWidth() {
        return read();
      },
      get textContent() {
        return text;
      },
      set textContent(value: string) {
        text = value;
        dirty = true;
        writes++;
      },
    } as HTMLElement;
  });
  const summaries = createTargetSummaries();
  const remove = spans.map((span) => summaries.add(span, "Orders, Orders canary", "Orders +1"));
  await Promise.resolve();
  expect(reads).toBe(512);
  expect(forced).toBe(0);
  expect(writes).toBe(256);
  expect(spans.every((span) => span.textContent === "Orders +1")).toBe(true);
  const notify = (width: number) =>
    resize(
      spans.map((target) => ({ target, contentRect: { width } })) as unknown as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
  reads = writes = 0;
  notify(100);
  expect(writes).toBe(0);
  notify(200);
  expect(spans.every((span) => span.textContent === "Orders, Orders canary")).toBe(true);
  expect(writes).toBe(256);
  notify(240);
  expect(writes).toBe(256);
  expect(reads).toBe(0);
  // Changing locale can replace the compact form while React's full-text child stays identical.
  notify(80);
  for (const cleanup of remove) cleanup();
  expect(unobserve).toHaveBeenCalledTimes(256);
  expect(disconnect).toHaveBeenCalledTimes(1);
  reads = writes = forced = 0;
  dirty = false;
  const removeTranslated = spans.map((span) => summaries.add(span, "Orders, Orders canary", "Orders (+1)"));
  await Promise.resolve();
  expect(spans.every((span) => span.textContent === "Orders (+1)")).toBe(true);
  expect(forced).toBeLessThanOrEqual(1);
  expect(reads).toBe(512);
  for (const cleanup of removeTranslated) cleanup();
});
