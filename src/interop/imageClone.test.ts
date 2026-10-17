import { afterEach, expect, it, vi } from "vitest";
import { Slicer } from "./imageClone";

afterEach(() => vi.unstubAllGlobals());

it("bounds preparation notifications by visible percentage changes", () => {
  const progress: number[] = [];
  const slicer = new Slicer(1, { onProgress: (done) => progress.push(done) });
  for (let i = 0; i <= 1200; i++) slicer.progress(i / 10_000);
  expect(progress.length).toBeGreaterThan(0);
  expect(progress.length).toBeLessThanOrEqual(12);
  expect(progress.at(-1)).toBe(0.12);
  slicer.dispose();
});

it("counts clone elements consistently and reserves completion for the final picture", async () => {
  const progress: number[] = [];
  const slicer = new Slicer(2, { sliceMs: 0, onProgress: (done) => progress.push(done) });
  await slicer.step();
  await slicer.step();
  expect(progress).toHaveLength(2);
  expect(progress[0]).toBeCloseTo(0.425);
  expect(progress[1]).toBe(0.7);
  slicer.progress(0.8);
  await slicer.breathe();
  expect(progress.at(-1)).toBe(0.8);
  expect(progress.every((done) => done < 1)).toBe(true);
  slicer.dispose();
});
