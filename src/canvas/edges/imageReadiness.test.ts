import { afterEach, expect, it, vi } from "vitest";
import { whenEdgeGeometryReady } from "./imageReadiness";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";

vi.mock("../geometry/shapedRuntime", () => ({ loadShapedRoutes: vi.fn() }));
vi.mock("./edgeDetailsRuntime", () => ({ loadEdgeDetails: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("stops readiness work when cancelled during a held geometry download", async () => {
  let release!: () => void;
  vi.mocked(loadShapedRoutes).mockReturnValue(
    new Promise((resolve) => {
      release = () => resolve(undefined as never);
    }),
  );
  const frames = vi.fn();
  vi.stubGlobal("requestAnimationFrame", frames);
  const cancel = new AbortController();
  const root = { querySelector: vi.fn((selector: string) => (selector.includes("details") ? null : ({} as Element))) };
  const waiting = whenEdgeGeometryReady(root, cancel.signal)!;
  cancel.abort();
  await expect(waiting).rejects.toBe(cancel.signal.reason);
  const reads = root.querySelector.mock.calls.length;
  release();
  await Promise.resolve();
  await Promise.resolve();
  expect(frames).not.toHaveBeenCalled();
  expect(loadEdgeDetails).not.toHaveBeenCalled();
  expect(root.querySelector).toHaveBeenCalledTimes(reads);
});

it("cancels an outstanding readiness frame and starts no further loaders", async () => {
  vi.mocked(loadShapedRoutes).mockResolvedValue(undefined as never);
  let scheduled!: () => void;
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((run: () => void) => {
      scheduled = run;
      return 17;
    }),
  );
  const cancelFrame = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancelFrame);
  const cancel = new AbortController();
  const waiting = whenEdgeGeometryReady({ querySelector: () => ({}) as Element }, cancel.signal)!;
  await vi.waitFor(() => expect(scheduled).toBeTypeOf("function"));
  cancel.abort();
  await expect(waiting).rejects.toBe(cancel.signal.reason);
  expect(cancelFrame).toHaveBeenCalledWith(17);
  expect(loadShapedRoutes).toHaveBeenCalledOnce();
  expect(loadEdgeDetails).toHaveBeenCalledOnce();
});
