// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { capturePanPointer } from "./panPointer";

it("captures only canvas pans and lets the browser release the pointer on up/cancel", () => {
  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  const card = document.createElement("div");
  pane.append(card);
  const capture = vi.fn();
  card.setPointerCapture = capture;
  const down = (button: number, edit: boolean, space = false, pointerType = "mouse") => {
    const event = new PointerEvent("pointerdown", { button, pointerId: 17, pointerType });
    card.addEventListener("pointerdown", (e) => capturePanPointer(e, edit, space), { once: true });
    card.dispatchEvent(event);
  };
  down(0, true);
  down(2, true);
  down(0, false, false, "touch");
  expect(capture).not.toHaveBeenCalled();
  down(1, true);
  down(0, true, true);
  down(0, false);
  expect(capture.mock.calls).toEqual([[17], [17], [17]]);
  capture.mockClear();
  for (const className of ["nopan", ""]) {
    card.className = className;
    if (!className) pane.className = "";
    down(1, true);
  }
  expect(capture).not.toHaveBeenCalled();
  pane.className = "react-flow__pane";
  const button = document.createElement("button");
  button.setPointerCapture = capture;
  pane.append(button);
  button.addEventListener("pointerdown", (e) => capturePanPointer(e, false, false));
  button.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerType: "mouse" }));
  expect(capture).not.toHaveBeenCalled();
});
