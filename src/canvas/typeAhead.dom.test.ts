// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  captureModalTypeAhead,
  captureTypeAhead,
  dismissPendingTypeAheadModal,
  handoffTypeAhead,
  typeAheadActive,
} from "./typeAhead";
import { createDomPort } from "./interaction/domPort";
import { createInteractionController } from "./interaction/controller";

afterEach(() => document.body.replaceChildren());

it("a deferred menu pick hands the name and its finish key to the new naming capture", () => {
  const done = vi.fn();
  const pending = captureTypeAhead();
  for (const key of ["C", "a", "c", "h", "e", "Escape"])
    window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
  const typed = pending.stop();
  const name = captureTypeAhead(undefined, done);
  try {
    handoffTypeAhead(typed);
    expect(name.read()).toEqual({ text: "Cache", done: "escape" });
    expect(done).toHaveBeenCalledExactlyOnceWith({ text: "Cache", done: "escape" });
  } finally {
    name.stop();
  }
});

it("placement hands its prefix to a cold field; pending keys commit once before capture releases", () => {
  const controller = createInteractionController(createDomPort({ root: () => null, hasEdge: () => true }), {
    frame: () => () => {},
    microtask: (run) => run(),
  });
  const disconnect = controller.connect();
  const key = (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
  const accept = vi.fn((typed) => {
    expect(typeAheadActive()).toBe(true);
    expect(controller.mode.value).toBe("committing");
    expect(typed).toEqual({ text: "Prefix API", done: "enter" });
  });
  try {
    const placement = controller.captureName("e", accept);
    for (const letter of "Prefix X") key(letter);
    const prefix = placement.handoff();
    expect(prefix).toEqual({ text: "Prefix X" });
    controller.dispatch({
      type: "inspector.field",
      seq: 1,
      name: "label",
      owner: "e",
      text: prefix?.text ?? undefined,
      acceptName: accept,
    });
    key("Backspace");
    for (const letter of "API") key(letter);
    // The newest pending owner gets its own keys and Escape, then the older capture resumes in order.
    const modal = captureModalTypeAhead(vi.fn());
    key("x");
    expect(modal.stop()).toEqual({ text: "x" });
    key("Enter");
    expect(accept).toHaveBeenCalledOnce();
    expect(typeAheadActive()).toBe(false);
    expect(placement.handoff()).toBeNull();
  } finally {
    disconnect();
  }
});

it("a pending modal capture precedes naming even when the controller's listener was installed first", () => {
  const controller = createInteractionController(createDomPort({ root: () => null, hasEdge: () => true }), {
    frame: () => () => {},
    microtask: (run) => run(),
  });
  const disconnect = controller.connect();
  const escape = (event: KeyboardEvent) => {
    if (event.key === "Escape" && controller.escape()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener("keydown", escape, true);
  controller.dispatch({ type: "inspector.field", seq: 1, name: "label", owner: "e" });
  const close = vi.fn();
  const modal = captureModalTypeAhead(close);
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    expect(modal.stop()).toEqual({ text: null, done: "escape" });
    expect(controller.mode).toMatchObject({ value: "naming", target: "e" });
    expect(typeAheadActive()).toBe(true);
    expect(dismissPendingTypeAheadModal()).toBe(false);
  } finally {
    modal.stop();
    disconnect();
    window.removeEventListener("keydown", escape, true);
  }
});

it("pending modal ownership follows the capture stack and is released on stop or Escape outside a canvas", () => {
  const close = vi.fn();
  const modal = captureModalTypeAhead(close);
  const menu = captureTypeAhead();
  try {
    expect(dismissPendingTypeAheadModal()).toBe(false);
    menu.stop();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    expect(dismissPendingTypeAheadModal()).toBe(false);
    expect(typeAheadActive()).toBe(false);
  } finally {
    menu.stop();
    modal.stop();
  }
  const stopped = captureModalTypeAhead(close);
  stopped.stop();
  expect(dismissPendingTypeAheadModal()).toBe(false);
  expect(close).toHaveBeenCalledOnce();
});

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

// R-49ad249fb4: a pending palette holds typing, but its loading dialog's Close takes Enter and Space.
it("a pending modal's own buttons take Enter and Space; typing elsewhere is still held", () => {
  const close = vi.fn();
  const dialog = Object.assign(document.createElement("div"), { role: "dialog" });
  dialog.setAttribute("aria-modal", "true");
  const button = Object.assign(document.createElement("button"), { textContent: "Close" });
  const outside = document.createElement("button");
  dialog.append(button);
  document.body.append(dialog, outside);
  const capture = captureModalTypeAhead(close);
  const press = (target: Element, key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  try {
    expect(press(button, "Enter")).toBe(false);
    expect(press(button, " ")).toBe(false);
    expect(press(button, "k")).toBe(true);
    expect(press(outside, "Enter")).toBe(true);
    expect(capture.stop()).toEqual({ text: "k", done: "enter" });
    expect(close).not.toHaveBeenCalled();
  } finally {
    capture.stop();
  }
});

it("focus inside a pending modal's loading frame doesn't leave a pending rename; the loaded modal does", () => {
  const canvas = document.createElement("div");
  const dialog = document.createElement("div");
  dialog.setAttribute("aria-modal", "true");
  const close = document.createElement("button");
  dialog.append(close);
  document.body.append(canvas, dialog);
  const port = createDomPort({ root: () => canvas, hasEdge: () => true });
  expect(port.elsewhere?.(close)).toBe(true);
  const pending = captureModalTypeAhead(vi.fn());
  try {
    expect(port.elsewhere?.(close)).toBe(false);
    expect(port.elsewhere?.(document.body)).toBe(true);
  } finally {
    pending.stop();
  }
  expect(port.elsewhere?.(close)).toBe(true);
});
