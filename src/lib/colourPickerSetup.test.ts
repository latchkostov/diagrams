import type { Page } from "@playwright/test";
import { expect, it, vi } from "vitest";
import { openBackgroundPicker } from "../../tests/e2e/colour-picker-setup";

it("does not dispatch the Colour click until the independently loaded description acknowledges layout", async () => {
  let mounted!: () => void;
  let waiting!: () => void;
  const requested = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const description = new Promise<void>((resolve) => {
    mounted = resolve;
  });
  const click = vi.fn(async () => {});
  const page = {
    getByTestId: (id: string) =>
      id === "inspector-field-description"
        ? {
            waitFor: ({ state }: { state: string }) => {
              expect(state).toBe("visible");
              waiting();
              return description;
            },
          }
        : { click: id === "inspector-toggle" ? vi.fn(async () => {}) : click },
  } as unknown as Page;
  const opening = openBackgroundPicker(page);
  await requested;
  expect(click).not.toHaveBeenCalled();
  mounted();
  await opening;
  expect(click).toHaveBeenCalledOnce();
});
