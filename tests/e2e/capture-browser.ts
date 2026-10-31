import { test } from "./fixtures";

/** Full Chromium accepts tab capture. Extend the shared launch options so native repairs remain in force. */
export const captureTest = test.extend({
  channel: "chromium",
  launchOptions: async ({ launchOptions }, use) => {
    await use({
      ...launchOptions,
      args: [...(launchOptions.args ?? []), "--auto-accept-this-tab-capture"],
    });
  },
});
