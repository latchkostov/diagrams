// The parity harness's Node tier (docs/PARITY.md): the app's own Vite config (the i18n transform, the virtual
// modules), with only the parity files and no type checking (`pnpm typecheck` covers them). Run it through
// scripts/parity.mjs, which also summarises the ledger and finds stale goldens.
import { defineConfig } from "vitest/config";
import app from "../../vite.config";

process.env.PARITY_TIER = "node";

export default defineConfig({
  ...app,
  test: {
    ...app.test,
    include: ["tests/parity/node/**/*.parity.ts"],
    setupFiles: ["tests/parity/node/setup.ts"],
    typecheck: { enabled: false },
    // Whole simulations run in one test; no budget is measured, this is only a hang backstop.
    testTimeout: 300_000,
    // Readable diffs: the error message is the diff, so keep it whole.
    chaiConfig: { truncateThreshold: 0 },
    env: { PARITY_TIER: "node" },
  },
});
