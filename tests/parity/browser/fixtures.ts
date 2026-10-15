// The browser tier's `test`: after each test, every golden it changed is reported at once
// (tests/parity/lib/golden.ts).
import { test as base } from "@playwright/test";
import { assertGoldens } from "../lib/golden";

export const test = base.extend<{ goldens: undefined }>({
  goldens: [
    // eslint-disable-next-line no-empty-pattern -- Playwright's fixture signature: this one uses no other fixture.
    async ({}, use) => {
      await use(undefined);
      assertGoldens();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
