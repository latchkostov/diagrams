import { afterEach, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { precisionDragStart } from "../../tests/e2e/drag-geometry";

const { waitForCameraIdle, viewportTransform } = vi.hoisted(() => ({
  waitForCameraIdle: vi.fn(),
  viewportTransform: vi.fn(),
}));
vi.mock("../../tests/e2e/fixtures", () => ({ waitForCameraIdle, viewportTransform }));
afterEach(() => vi.resetAllMocks());

it("measures the drag's zoom and pointer together after the queued fit refinement", async () => {
  let release!: () => void;
  const camera = new Promise<void>((resolve) => (release = resolve));
  waitForCameraIdle.mockReturnValue(camera);
  viewportTransform.mockResolvedValue("translate(175.769px, 83.5534px) scale(0.859223)");
  const bounds = vi.fn(async () => ({ x: 200, y: 300, width: 220, height: 72 }));
  const page = { getByTestId: vi.fn(() => ({ boundingBox: bounds })) } as unknown as Page;
  const measuring = precisionDragStart(page, "node-c");
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(viewportTransform).not.toHaveBeenCalled();
  expect(bounds).not.toHaveBeenCalled();
  // The actual native failure mixed the first fit's zoom with the refined node box.
  viewportTransform.mockResolvedValue("translate(180.076px, 83.1165px) scale(0.851942)");
  bounds.mockResolvedValue({ x: 210, y: 305, width: 220, height: 72 });
  release();
  await expect(measuring).resolves.toEqual({ zoom: 0.851942, press: { x: 320, y: 341 } });
  expect(waitForCameraIdle).toHaveBeenCalledExactlyOnceWith(page);
  expect(page.getByTestId).toHaveBeenCalledExactlyOnceWith("node-c");
});
