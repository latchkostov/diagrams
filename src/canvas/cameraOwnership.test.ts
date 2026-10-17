import { expect, it } from "vitest";
import { createCameraOwnership } from "./cameraOwnership";

it.each(["fit", "narration"] as const)("a new %s view replaces manual ownership", (owner) => {
  const camera = createCameraOwnership();
  const manual = camera.claim("manual");
  const next = camera.claim(owner);
  expect(camera.owner).toBe(owner);
  expect(camera.isCurrent(manual)).toBe(false);
  expect(camera.isCurrent(next)).toBe(true);
});

it("manual input invalidates deferred fit and narration work", () => {
  const camera = createCameraOwnership();
  const fit = camera.claim("fit");
  const narration = camera.claim("narration");
  const manual = camera.claim("manual");
  expect(camera.owner).toBe("manual");
  expect(camera.isCurrent(fit)).toBe(false);
  expect(camera.isCurrent(narration)).toBe(false);
  expect(camera.isCurrent(manual)).toBe(true);
});

it("returning to the same owner never revives an older deferred command", () => {
  const camera = createCameraOwnership();
  const oldFit = camera.claim("fit");
  camera.claim("manual");
  const newFit = camera.claim("fit");
  expect(camera.isCurrent(oldFit)).toBe(false);
  expect(camera.isCurrent(newFit)).toBe(true);
  const newerFit = camera.claim("fit");
  expect(camera.isCurrent(newFit)).toBe(false);
  expect(camera.isCurrent(newerFit)).toBe(true);
});
