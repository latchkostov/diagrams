import { expect, it, vi } from "vitest";
import { machinePaths } from "../../lib/machine";
import { createMessageCard, messageCardMachine } from "./messageCard";
import { createInteractionController } from "./controller";

it("dismisses a focused card once; later Escape reaches the next owner", () => {
  const controller = createInteractionController(
    {
      active: () => null,
      resolve: () => ({ state: "gone" }),
      focus: () => false,
      connected: () => true,
      publish: () => {},
    },
    { frame: () => () => {}, microtask: (run) => run() },
  );
  const card = createMessageCard();
  const changed = vi.fn();
  const unsubscribe = card.subscribe(changed);
  const lower = vi.fn(() => true);
  const detachLower = controller.attachEscape(lower);
  const detach = controller.attachEscape(card.escape);
  expect(controller.escape()).toBe(true);
  expect(card.getSnapshot()).toBe(false);
  expect(lower).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(controller.escape()).toBe(true);
  expect(lower).toHaveBeenCalledTimes(1);
  detach();
  detachLower();
  unsubscribe();
  expect(controller.escape()).toBe(false);
  expect(createMessageCard().getSnapshot()).toBe(true);
});

it("machine paths keep dismissal final for a focus lifetime", () => {
  const paths = machinePaths(messageCardMachine, { maxDepth: 4 });
  expect(new Set(paths.map(({ state }) => state.value))).toEqual(new Set(["open", "dismissed"]));
  for (const { state, events } of paths) expect(state.value).toBe(events.length ? "dismissed" : "open");
});
