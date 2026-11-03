// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { canvasSample } from "../../tests/bench/ui/canvasSample";

afterEach(() => document.body.replaceChildren());

function canvas() {
  const pane = document.createElement("div");
  pane.dataset.testid = "canvas-wrap";
  pane.dataset.fitPending = "false";
  pane.dataset.cameraState = "idle";
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  const viewport = document.createElement("div");
  viewport.style.transform = "translate(10px, 20px) scale(0.5)";
  const nodes = document.createElement("div");
  const node = document.createElement("div");
  node.dataset.testid = "rf__node-sample";
  nodes.append(node);
  viewport.append(nodes);
  pane.append(viewport);
  document.body.append(pane);
  return { pane, viewport };
}

it.each(["pending", "deferred", "animating"])("rejects stable geometry while the camera is %s", (state) => {
  const { pane } = canvas();
  const ready = canvasSample();
  expect(ready).not.toBe("");
  pane.dataset.cameraState = state;
  expect(canvasSample()).toBe("");
  pane.dataset.cameraState = "idle";
  expect(canvasSample()).toBe(ready);
});

it("does not settle a missing or hidden pane or viewport", () => {
  expect(canvasSample()).toBe("");
  const { pane, viewport } = canvas();
  viewport.remove();
  expect(canvasSample()).toBe("");
  pane.append(viewport);
  pane.getBoundingClientRect = () => new DOMRect();
  expect(canvasSample()).toBe("");
});

it("samples pane geometry and the transform together, only after measurement completes", () => {
  const { pane, viewport } = canvas();
  const before = canvasSample();
  // A layout read can flush style work: the transform must be read in that same browser task.
  pane.getBoundingClientRect = () => {
    viewport.style.transform = "translate(40px, 50px) scale(1)";
    return new DOMRect(10, 20, 800, 600);
  };
  expect(JSON.parse(canvasSample())).toEqual([10, 20, 800, 600, viewport.style.transform]);
  expect(canvasSample()).not.toBe(before);
  pane.dataset.fitPending = "true";
  expect(canvasSample()).toBe("");
});
