import { afterEach, expect, it, vi } from "vitest";
import { Slicer } from "./imageClone";

afterEach(() => vi.unstubAllGlobals());

it("counts clone elements consistently and reserves completion for the final picture", async () => {
  const progress: number[] = [];
  const slicer = new Slicer(2, { sliceMs: 0, onProgress: (done) => progress.push(done) });
  await slicer.step();
  await slicer.step();
  expect(progress).toEqual([0.35, 0.7]);
  slicer.progress(0.8);
  await slicer.breathe();
  expect(progress.at(-1)).toBe(0.8);
  expect(progress.every((done) => done < 1)).toBe(true);
  slicer.dispose();
});
