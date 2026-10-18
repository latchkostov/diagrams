import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";
import { installCaptureReady } from "../../tests/e2e/capture-ready";

it("recognizes painted marker states after capture colour conversion, rejecting stale and neutral pixels", () => {
  const matches = runInNewContext(`(${installCaptureReady.toString()})(); window.__captureMarker`, {
    window: {},
  }) as Window["__captureMarker"];
  // Actual Linux tab-capture pixels for the CSS green [24, 205, 57].
  expect(matches([10, 179, 58], true)).toBe(true);
  expect(matches([10, 179, 58], false)).toBe(false);
  expect(matches([216, 35, 194], false)).toBe(true);
  expect(matches([216, 35, 194], true)).toBe(false);
  expect(matches([241, 245, 246], true)).toBe(false);
  expect(matches([241, 245, 246], false)).toBe(false);
});

it("does not mistake repeated old video frames for acknowledgment of a page paint", async () => {
  const callbacks: (() => void)[] = [];
  let frame = "old";
  let done = false;
  const captureReadyFrame = runInNewContext(`(${installCaptureReady.toString()})()`, { window: {} }) as ReturnType<
    typeof installCaptureReady
  >;
  const pending = captureReadyFrame<string>(
    (callback) => {
      callbacks.push(callback);
    },
    () => frame,
    (value) => value === "painted",
  ).then((value) => {
    done = true;
    return value;
  });
  for (let i = 0; i < 5; i++) {
    callbacks.shift()!();
    await setImmediate();
    expect(done).toBe(false);
  }
  frame = "painted";
  callbacks.shift()!();
  expect(await pending).toBe("painted");
});
