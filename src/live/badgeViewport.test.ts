// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { watchBadgeViewport } from "./badgeViewport";
import { suspendFrameCapture } from "../canvas/camera/frameCapture";

it("refreshes every readout synchronously for nested captures, then resumes viewport filtering", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  const changed = vi.fn();
  const dispose = watchBadgeViewport(root, changed);
  const query = changed.mock.calls[0][0] as unknown;
  expect(query).toBeTypeOf("function");
  const viewport = root.firstElementChild!;
  const restore = suspendFrameCapture(viewport);
  expect(changed).toHaveBeenLastCalledWith(null);
  expect(changed).toHaveBeenCalledTimes(2);
  const nested = suspendFrameCapture(viewport);
  nested();
  expect(changed).toHaveBeenCalledTimes(2);
  restore();
  expect(changed).toHaveBeenLastCalledWith(query);
  dispose();
  suspendFrameCapture(viewport)();
  expect(changed).toHaveBeenCalledTimes(3);
});

it("does not publish a resume to an unmounted readout during capture cleanup", () => {
  const root = document.createElement("div");
  root.innerHTML = '<div class="react-flow__viewport"></div>';
  const changed = vi.fn();
  const dispose = watchBadgeViewport(root, changed);
  const restore = suspendFrameCapture(root.firstElementChild!);
  expect(changed).toHaveBeenCalledTimes(2);
  dispose();
  restore();
  expect(changed).toHaveBeenCalledTimes(2);
});
