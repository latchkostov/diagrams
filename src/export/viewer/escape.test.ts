import { afterEach, expect, it, vi } from "vitest";
import { onUnhandledEscape } from "./escape";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("lets late listeners consume Escape and snapshots surfaces before they close", async () => {
  vi.useFakeTimers();
  const window = new EventTarget();
  const querySelector = vi.fn();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", { querySelector });
  const dismiss = vi.fn();
  const off = onUnhandledEscape(dismiss);
  const press = () => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: "Escape" });
    window.dispatchEvent(event);
  };
  for (const surface of ["menu", "dialog", "capacity-panel", "sim-panel", "trace-card"]) {
    querySelector.mockImplementation((selector: string) => (selector.includes(surface) ? {} : null));
    press();
    querySelector.mockReturnValue(null);
    await vi.runAllTimersAsync();
    expect(dismiss).not.toHaveBeenCalled();
  }
  window.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
  press();
  await vi.runAllTimersAsync();
  expect(dismiss).not.toHaveBeenCalled();
  press();
  await vi.runAllTimersAsync();
  expect(dismiss).toHaveBeenCalledOnce();
  press();
  off();
  press();
  await vi.runAllTimersAsync();
  expect(dismiss).toHaveBeenCalledOnce();
});
