// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountChipHits } from "./chipHits";
import type { InteractionController } from "./interaction/controller";

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function setup() {
  document.body.innerHTML = `<div data-low-zoom="mid"><div class="react-flow__pane"></div><svg><g class="react-flow__edge" data-id="ab"><g class="fe-chip"><path class="fe-path" d="M0 0L100 0" /></g></g></svg></div>`;
  const root = document.body.firstElementChild as HTMLElement;
  const pane = root.firstElementChild!;
  const stroke = root.querySelector("path")!;
  Object.assign(stroke, { getScreenCTM: () => ({ a: 0.4, b: 0, inverse: () => ({}) }) });
  vi.stubGlobal(
    "DOMPoint",
    class {
      matrixTransform() {
        return { x: 50, y: 4 };
      }
    },
  );
  vi.stubGlobal("Path2D", vi.fn());
  vi.stubGlobal("getComputedStyle", () => ({ visibility: "visible" }));
  const dispatch = vi.fn();
  const interaction: Pick<InteractionController, "panHeld" | "gesture" | "dispatch"> = {
    panHeld: false,
    gesture: null,
    dispatch,
  };
  const context = { isPointInStroke: vi.fn(() => true), lineWidth: 0 };
  const selectable = vi.fn(() => true);
  const unmount = mountChipHits(root, context as unknown as CanvasRenderingContext2D, interaction, selectable);
  const forward = vi.fn();
  stroke.addEventListener("click", forward);
  const click = (button = 0) => {
    const event = new MouseEvent("click", { button, bubbles: true, cancelable: true });
    pane.dispatchEvent(event);
    return event;
  };
  return { interaction, dispatch, selectable, forward, click, unmount, context };
}

it("forwards primary selection before requesting edge focus through the policy", () => {
  const h = setup();
  h.selectable.mockImplementation(() => h.forward.mock.calls.length > 0);
  expect(h.click().defaultPrevented).toBe(true);
  expect(h.forward).toHaveBeenCalledOnce();
  expect(h.dispatch).toHaveBeenCalledWith({
    type: "selection.changed",
    cause: "click",
    target: { kind: "edge", id: "ab" },
    forwarded: true,
  });
  h.unmount();
  h.click();
  expect(h.forward).toHaveBeenCalledOnce();
});

it("does not move focus for context clicks or a nonselectable canvas", () => {
  const h = setup();
  h.click(2);
  h.selectable.mockReturnValue(false);
  h.click();
  expect(h.forward).toHaveBeenCalledTimes(2);
  expect(h.dispatch).not.toHaveBeenCalled();
});

it.each(["pan", "connect", "edge.end", "edge.segment", "node.drag", "middle"] as const)(
  "leaves %s pointer input and focus with its gesture owner",
  (kind) => {
    const h = setup();
    if (kind === "pan") Object.assign(h.interaction, { panHeld: true });
    else if (kind !== "middle") Object.assign(h.interaction, { gesture: { kind } });
    expect(h.click(kind === "middle" ? 1 : 0).defaultPrevented).toBe(false);
    expect(h.context.isPointInStroke).not.toHaveBeenCalled();
    expect(h.forward).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  },
);
