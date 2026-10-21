import { expect, it, vi } from "vitest";
import * as runtime from "./runtime";

const held = vi.hoisted(() => {
  let release!: () => void;
  return {
    requested: false,
    gate: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
});
vi.mock("./attachmentGeometry", async (importOriginal) => {
  held.requested = true;
  await held.gate;
  return importOriginal();
});

it("keeps the extended outline unpublished until its attachment sampler is ready", async () => {
  const loading = runtime.loadShapeGeometry();
  try {
    await expect.poll(() => held.requested).toBe(true);
    expect(runtime.extendedGeometry).toBeUndefined();
    expect(runtime.attachmentGeometry).toBeUndefined();
  } finally {
    held.release();
  }
  await loading;
  expect(runtime.extendedGeometry).toBeTypeOf("function");
  expect(runtime.attachmentGeometry).toBeDefined();
});
