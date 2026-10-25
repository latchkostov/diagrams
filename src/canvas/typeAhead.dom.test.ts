// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { captureTypeAhead, typeAheadActive } from "./typeAhead";
import { createDomPort } from "./interaction/domPort";
import { createInteractionController } from "./interaction/controller";

afterEach(() => document.body.replaceChildren());

function paste(text: string, target: EventTarget = window) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

it("buffers paste between keys, replaces the selected name, and removes the paste listener on stop", () => {
  const hold = captureTypeAhead();
  try {
    expect(paste("Orders")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
    expect(paste("API\r\nservice")).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }));
    expect(hold.stop()).toEqual({ text: "Orders-API servic" });
    expect(paste("ignored")).toBe(false);
  } finally {
    hold.stop();
  }
});

it("only the newest capture takes paste, and completed captures leave paste alone", () => {
  const first = captureTypeAhead();
  const second = captureTypeAhead();
  try {
    paste("newest");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(paste("after Enter")).toBe(false);
    expect(second.stop()).toEqual({ text: "newest", done: "enter" });
    paste("older");
    expect(first.stop()).toEqual({ text: "older" });
  } finally {
    second.stop();
    first.stop();
  }
});

it("rename paste respects another editable field even before focus reconciliation", () => {
  const input = document.createElement("input");
  document.body.append(input);
  const hold = createDomPort({ root: () => null }).holdKeys!(() => {});
  try {
    expect(paste("belongs here", input)).toBe(false);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true }));
    expect(hold.stop()).toEqual({ text: null });
  } finally {
    hold.stop();
  }
});

it("a palette capture can own typing from the field that opened it before its search arrives", () => {
  const input = document.createElement("input");
  document.body.append(input);
  const hold = captureTypeAhead();
  try {
    expect(paste("palette search", input)).toBe(true);
    expect(hold.stop()).toEqual({ text: "palette search" });
  } finally {
    hold.stop();
  }
});

it.each(["node", "edge", "boundary"])(
  "a deleted %s releases cold rename ownership before any fields arrive",
  (kind) => {
    let exists = true;
    const port = createDomPort({
      root: () => null,
      hasNode: () => kind !== "edge" && exists,
      hasEdge: () => kind === "edge" && exists,
    });
    const controller = createInteractionController(port, { frame: () => () => {}, microtask: (run) => run() });
    const disconnect = controller.connect();
    try {
      controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "target" });
      expect(typeAheadActive()).toBe(true);
      paste("discarded");
      exists = false;
      controller.rendered();
      expect(typeAheadActive()).toBe(false);
      const shortcut = new KeyboardEvent("keydown", { key: "t", cancelable: true });
      window.dispatchEvent(shortcut);
      expect(shortcut.defaultPrevented).toBe(false);
      expect(controller.state.pending).toBeNull();
    } finally {
      disconnect();
    }
  },
);
