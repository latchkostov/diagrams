// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { overlayAnimations } from "./overlayAnimations";

afterEach(() => document.body.replaceChildren());

function fixture() {
  const root = document.createElement("div");
  root.innerHTML = '<div data-testid="scene"><div></div></div><div data-canvas-overlay><span></span></div>';
  document.body.append(root);
  const overlay = root.querySelector<HTMLElement>("[data-canvas-overlay]")!;
  const discover = vi.fn<() => Animation[]>(() => []);
  Object.defineProperty(overlay, "getAnimations", { value: discover });
  Object.defineProperty(root, "getAnimations", {
    value: () => {
      throw new Error("Scene-wide animation scan");
    },
  });
  const wake = vi.fn(),
    discovered = vi.fn();
  return { root, overlay, discover, wake, discovered, gate: overlayAnimations(root, wake, discovered) };
}

it("discovers only overlay animations once between relevant mutations", () => {
  const f = fixture();
  expect(f.gate.pending()).toBe(false);
  for (let i = 0; i < 8; i++) {
    f.gate.changed([
      {
        target: f.root.firstElementChild!,
        type: "attributes",
        attributeName: "style",
        addedNodes: [],
        removedNodes: [],
      } as unknown as MutationRecord,
    ]);
    expect(f.gate.pending()).toBe(false);
  }
  expect(f.discover).toHaveBeenCalledOnce();
  expect(f.discovered).toHaveBeenCalledOnce();
  f.gate.changed([
    {
      target: f.overlay,
      type: "attributes",
      attributeName: "class",
      addedNodes: [],
      removedNodes: [],
    } as unknown as MutationRecord,
  ]);
  expect(f.gate.pending()).toBe(false);
  expect(f.discover).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "waits for delayed/paused entrances, then rediscovers on completion (cancelled: %s)",
  async (cancelled) => {
    const f = fixture();
    let finish!: () => void, cancel!: () => void;
    const animation = {
      playState: "paused",
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
      finished: new Promise<void>((resolve, reject) => {
        finish = resolve;
        cancel = () => reject(new Error("cancelled"));
      }),
    } as unknown as Animation;
    f.discover.mockReturnValue([animation]);
    expect(f.gate.pending()).toBe(true);
    expect(f.gate.pending()).toBe(true);
    expect(f.discover).toHaveBeenCalledOnce();
    Object.defineProperty(animation, "playState", { value: cancelled ? "idle" : "finished" });
    if (cancelled) cancel();
    else finish();
    await Promise.resolve();
    expect(f.wake).toHaveBeenCalledOnce();
    expect(f.gate.pending()).toBe(false);
    expect(f.discover).toHaveBeenCalledTimes(2);
  },
);

it("ignores infinite decorative chrome animations but discovers newly inserted overlays", () => {
  const f = fixture();
  f.discover.mockReturnValue([
    {
      playState: "running",
      effect: { getComputedTiming: () => ({ endTime: Infinity }) },
    } as Animation,
  ]);
  expect(f.gate.pending()).toBe(false);
  const added = f.overlay.cloneNode(true) as HTMLElement;
  Object.defineProperty(added, "getAnimations", { value: () => [] });
  f.root.append(added);
  f.gate.changed([
    {
      target: f.root,
      type: "childList",
      attributeName: null,
      addedNodes: [added],
      removedNodes: [],
    } as unknown as MutationRecord,
  ]);
  expect(f.gate.pending()).toBe(false);
  expect(f.discover).toHaveBeenCalledTimes(2);
});

it("rediscovers a mutation-free WAAPI entrance on the confirming sample", () => {
  const f = fixture();
  expect(f.gate.pending()).toBe(false);
  f.discover.mockReturnValue([
    {
      playState: "paused",
      finished: new Promise(() => {}),
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
    } as Animation,
  ]);
  expect(f.gate.pending(true)).toBe(true);
});

it("releases a cached paused animation when its target stops being an overlay", () => {
  const f = fixture();
  f.discover.mockReturnValue([
    {
      playState: "paused",
      finished: new Promise(() => {}),
      effect: { getComputedTiming: () => ({ endTime: 100 }) },
    } as Animation,
  ]);
  expect(f.gate.pending()).toBe(true);
  f.overlay.removeAttribute("data-canvas-overlay");
  f.gate.changed([
    {
      target: f.overlay,
      type: "attributes",
      attributeName: "data-canvas-overlay",
      addedNodes: [],
      removedNodes: [],
    } as unknown as MutationRecord,
  ]);
  expect(f.gate.pending()).toBe(false);
});
