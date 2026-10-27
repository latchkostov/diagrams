import { expect, it, vi } from "vitest";
import { requireEdgeModules } from "./readiness";
import { loadShapedRoutes } from "../geometry/shapedRuntime";
import { loadEdgeDetails } from "./edgeDetailsRuntime";
import { toast } from "../../interop/ui/toastRuntime";
const state = vi.hoisted(() => ({ online: false }));
vi.mock("../geometry/shapedRuntime", () => ({
  loadShapedRoutes: vi.fn(() => (state.online ? Promise.resolve() : Promise.reject(new Error("offline")))),
}));
vi.mock("./edgeDetailsRuntime", () => ({
  loadEdgeDetails: vi.fn(() => (state.online ? Promise.resolve() : Promise.reject(new Error("offline")))),
}));
it("the surviving retry recovers all required modules from separate edges", async () => {
  requireEdgeModules(true, false);
  requireEdgeModules(false, true);
  await vi.waitFor(() => expect(toast.current?.action?.testId).toBe("lazy-load-retry"));
  const shapes = vi.mocked(loadShapedRoutes).mock.calls.length;
  const details = vi.mocked(loadEdgeDetails).mock.calls.length;
  state.online = true;
  toast.current!.action!.run();
  expect(vi.mocked(loadShapedRoutes).mock.calls.length).toBe(shapes + 1);
  expect(vi.mocked(loadEdgeDetails).mock.calls.length).toBe(details + 1);
});
