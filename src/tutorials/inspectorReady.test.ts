import { expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { tutorialInspectorReady } from "../../tests/e2e/tutorial-inspector-ready";

// An event-loop turn drains every promise continuation, including the outer async helper.
const settled = () => new Promise<void>((resolve) => setImmediate(resolve));

it.each(["inspector-node-description-toggle", "planning-explanation-c"])(
  "waits when only %s was already visible",
  async (visible) => {
    let release!: () => void;
    const getByTestId = (id: string) => ({
      waitFor: () =>
        id === visible
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              release = resolve;
            }),
    });
    let ready = false;
    const pending = tutorialInspectorReady({ getByTestId } as unknown as Pick<Page, "getByTestId">).then(() => {
      ready = true;
    });
    await settled();
    expect(ready).toBe(false);
    release();
    await pending;
    expect(ready).toBe(true);
  },
);

it.each([false, true])("waits for both late Inspector sections (planning first: %s)", async (planningFirst) => {
  const releases = new Map<string, () => void>();
  const getByTestId = vi.fn((id: string) => ({
    waitFor: ({ state }: { state: string }) => {
      expect(state).toBe("visible");
      return new Promise<void>((resolve) => releases.set(id, resolve));
    },
  }));
  let ready = false;
  const pending = tutorialInspectorReady({ getByTestId } as unknown as Pick<Page, "getByTestId">).then(() => {
    ready = true;
  });
  expect([...releases.keys()]).toEqual(["inspector-node-description-toggle", "planning-explanation-c"]);
  await settled();
  expect(ready).toBe(false);
  const [first, last] = [...releases.keys()];
  releases.get(planningFirst ? last : first)!();
  await settled();
  expect(ready).toBe(false);
  releases.get(planningFirst ? first : last)!();
  await pending;
  expect(ready).toBe(true);
});
