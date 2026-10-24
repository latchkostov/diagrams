// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { createInteractionController } from "./controller";
import { createDomPort } from "./domPort";
import { captureTypeAhead, deliverPendingKey, type PendingKey } from "../typeAhead";

const cleanups: (() => void)[] = [];
afterEach(() =>
  cleanups
    .splice(0)
    .reverse()
    .forEach((stop) => stop()),
);
afterEach(() => document.body.replaceChildren());

function harness() {
  const tasks: (() => void)[] = [];
  let owns = true;
  const controller = createInteractionController(createDomPort({ root: () => null }), {
    frame: () => () => {},
    microtask: (run) => tasks.push(run),
  });
  const pending = controller.menuInput();
  cleanups.push(pending.capture(() => owns));
  return {
    pending,
    leave: () => {
      owns = false;
    },
    flush: () => tasks.splice(0).forEach((run) => run()),
    key: (key: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true })),
  };
}

it("hands keys after the picked action to the newest rename capture exactly once", () => {
  const h = harness();
  for (const key of ["c", "ArrowDown", "Enter", "N", "a", "m", "e", "Escape"]) expect(h.key(key)).toBe(false);
  const menu: string[] = [];
  let name: ReturnType<typeof captureTypeAhead> | undefined;
  const deliver = (key: PendingKey) => {
    if (deliverPendingKey(key)) return;
    menu.push(key.key);
    if (key.key === "Enter") {
      name = captureTypeAhead();
      cleanups.push(name.stop);
      // Unmounting the picked menu retires its capture, never the remaining ordered input.
      h.pending.cancel();
    }
  };
  h.pending.ready(deliver, () => {});
  h.pending.ready(deliver, () => {});
  h.flush();
  expect(menu).toEqual(["c", "ArrowDown", "Enter"]);
  expect(name?.stop()).toEqual({ text: "Name", done: "escape" });
});

it("cancels a late completion and releases another control's Enter", () => {
  const h = harness();
  h.key("c");
  const delivered: string[] = [];
  h.pending.ready(
    (key) => delivered.push(key.key),
    () => {},
  );
  h.leave();
  expect(h.key("Enter")).toBe(true);
  h.flush();
  expect(delivered).toEqual([]);
});

it("does not revive cancelled input when a StrictMode mount captures again", () => {
  const h = harness();
  h.key("x");
  const delivered: string[] = [];
  h.pending.ready(
    (key) => delivered.push(key.key),
    () => {},
  );
  h.pending.cancel();
  cleanups.push(h.pending.capture(() => true));
  h.key("y");
  h.pending.ready(
    (key) => delivered.push(key.key),
    () => {},
  );
  h.flush();
  expect(delivered).toEqual(["y"]);
});

it("continues placement's typed prefix while the inspector's field is still downloading", () => {
  const panel = document.createElement("aside");
  panel.dataset.testid = "inspector";
  document.body.append(panel);
  const controller = createInteractionController(createDomPort({ root: () => null }), {
    frame: () => () => {},
    microtask: (run) => run(),
  });
  cleanups.push(controller.connect());
  let saved = "C";
  controller.dispatch({
    type: "inspector.field",
    seq: 1,
    name: "label",
    owner: "n",
    caret: "end",
    text: "C",
    naming: (typed) => {
      if (typed.text !== null) saved = typed.text;
    },
  });
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
  expect(saved).toBe("Ca"); // Durable before the name field arrives, as each mounted-field edit is.
  const input = document.createElement("input");
  input.dataset.testid = "inspector-field-label";
  input.dataset.nameField = "n";
  input.value = "C";
  panel.append(input);
  controller.rendered();
  expect(input.value).toBe("Ca");
  expect(document.activeElement).toBe(input);
});
