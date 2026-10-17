import { afterEach, expect, it, vi } from "vitest";

class Element extends EventTarget {
  closest() {
    return null;
  }
}
class KeyboardEvent extends Event {
  constructor(
    type: string,
    readonly key: string,
  ) {
    super(type, { cancelable: true });
  }
}

afterEach(() => vi.unstubAllGlobals());

it("holds every touch event non-passively and lets modifier releases reach keyboard state", async () => {
  const window = new EventTarget();
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  vi.stubGlobal("window", window);
  vi.stubGlobal("Element", Element);
  vi.stubGlobal("KeyboardEvent", KeyboardEvent);
  vi.resetModules();
  const { holdInput } = await import("./inputHold");
  expect(add.mock.calls.some(([type]) => type.startsWith("touch"))).toBe(false);
  const release = holdInput();
  const releaseOther = holdInput();
  const touches: string[] = [];
  const target = new Element();
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
    window.addEventListener(type, () => touches.push(type));
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(add.mock.calls).toContainEqual([type, expect.any(Function), { capture: true, passive: false }]);
  }
  expect(touches).toEqual([]);
  const keys: string[] = [];
  window.addEventListener("keyup", (e) => keys.push((e as KeyboardEvent).key));
  for (const key of ["Control", "Shift", "Alt", "Meta", "x"]) window.dispatchEvent(new KeyboardEvent("keyup", key));
  expect(keys).toEqual(["Control", "Shift", "Alt", "Meta"]);
  release();
  expect(remove.mock.calls).toHaveLength(0);
  releaseOther();
  for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"])
    expect(remove.mock.calls).toContainEqual([type, expect.any(Function), { capture: true }]);
  window.dispatchEvent(new Event("touchstart", { cancelable: true }));
  expect(touches).toEqual(["touchstart"]);
});
