// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { replayKey } from "./replayKeys";

afterEach(() => document.body.replaceChildren());

function key(target: HTMLElement, value: string) {
  document.body.append(target);
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

it.each(["capturing", "on"] as const)("%s preserves native activation and slider Escape", (status) => {
  for (const tag of ["button", "select", "input", "a", "summary"]) {
    for (const value of ["Enter", " "]) {
      expect(replayKey(key(document.createElement(tag), value), status)).toBeUndefined();
    }
  }
  const slider = document.createElement("input");
  slider.type = "range";
  expect(replayKey(key(slider, "Escape"), status)).toBe("escape");
  expect(replayKey(key(slider, "ArrowRight"), status)).toBeUndefined();
  expect(replayKey(key(document.createElement("button"), "ArrowRight"), status)).toBe(
    status === "on" ? "forward" : "reserve",
  );
});

it("armed replay keeps Escape but releases every Live shortcut", () => {
  for (const value of ["Enter", " ", "ArrowLeft", "ArrowRight"]) {
    expect(replayKey(key(document.createElement("div"), value), "armed")).toBeUndefined();
  }
  expect(replayKey(key(document.createElement("div"), "Escape"), "armed")).toBe("escape");
});

it("only replay keys are reserved while capturing, below menus, selections and editable fields", () => {
  for (const value of ["Enter", " ", "ArrowLeft", "ArrowRight"]) {
    expect(replayKey(key(document.createElement("div"), value), "capturing")).toBe("reserve");
  }
  expect(replayKey(key(document.createElement("div"), "l"), "capturing")).toBeUndefined();
  expect(replayKey(key(document.createElement("textarea"), "Escape"), "capturing")).toBeUndefined();
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  expect(replayKey(key(menu, "Escape"), "on")).toBeUndefined();
  menu.remove();
  const selected = document.createElement("div");
  selected.className = "react-flow__node selected";
  expect(replayKey(key(selected, "Escape"), "on")).toBeUndefined();
});
