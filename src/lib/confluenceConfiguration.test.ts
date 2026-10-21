import { afterEach, expect, it, vi } from "vitest";
import { ConfigurationLifecycle } from "../../integrations/confluence-forge/src/configurationState";
import { requestFocus } from "../../integrations/confluence-forge/src/dom";

afterEach(() => vi.unstubAllGlobals());

it("invalidates pending reads only once the host has closed the configuration", async () => {
  const lifecycle = new ConfigurationLifecycle();
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const request = vi.fn(
    () =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const closing = lifecycle.close(request);
  expect(lifecycle.closing).toBe(true);
  expect(lifecycle.closed).toBe(false);
  expect(lifecycle.generation).toBe(0);
  await lifecycle.close(request);
  expect(request).toHaveBeenCalledOnce();
  reject(new Error("bridge failed"));
  await expect(closing).rejects.toThrow("bridge failed");
  expect(lifecycle.closing).toBe(false);
  expect(lifecycle.closed).toBe(false);
  expect(lifecycle.generation).toBe(0);
  const retry = lifecycle.close(request);
  resolve();
  await retry;
  expect(lifecycle.closed).toBe(true);
  expect(lifecycle.generation).toBe(1);
});

it.each(["stay", "leave", "return", "control"])("async focus respects reader navigation: %s", (navigation) => {
  const document = Object.assign(new EventTarget(), { hasFocus: vi.fn(() => true) });
  const window = new EventTarget();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  const target = { focus: vi.fn() } as unknown as HTMLElement;
  const focus = requestFocus();
  if (navigation === "leave") document.hasFocus.mockReturnValue(false);
  if (navigation === "return") window.dispatchEvent(new Event("blur"));
  if (navigation === "control") document.dispatchEvent(new Event("focusin"));
  focus(target);
  expect(target.focus).toHaveBeenCalledTimes(navigation === "stay" ? 1 : 0);
});
