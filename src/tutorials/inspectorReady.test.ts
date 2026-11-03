import { expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { tutorialInspectorReady } from "../../tests/e2e/tutorial-inspector-ready";

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
  expect([...releases.keys()]).toEqual(["inspector-field-node-description-editor", "planning-explanation-c"]);
  await Promise.resolve();
  expect(ready).toBe(false);
  const [first, last] = [...releases.keys()];
  releases.get(planningFirst ? last : first)!();
  await Promise.resolve();
  await Promise.resolve();
  expect(ready).toBe(false);
  releases.get(planningFirst ? first : last)!();
  await pending;
  expect(ready).toBe(true);
});
