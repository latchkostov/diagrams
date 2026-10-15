// The parity harness's Node tier (docs/PARITY.md): the app's own Vite config (the i18n transform, the virtual
// modules), with only the parity files and no type checking (`pnpm typecheck` covers them). Run it through
// scripts/parity.mjs, which also summarises the ledger and finds stale goldens.
import { defineConfig, type Plugin } from "vitest/config";
import app from "../../vite.config";

process.env.PARITY_TIER = "node";

/**
 * The harness never loads src/examples/private (CLAUDE.md). Vitest runs with DEV set, where the examples registry
 * (src/examples/index.ts, reached through src/lib/diagramIO.ts) imports every local-only diagram eagerly; here its
 * glob is emptied before Vite expands it, and any module from that folder is refused outright.
 */
function publicExamplesOnly(): Plugin {
  const PRIVATE_GLOB = 'import.meta.glob<DiagramFile>("./private/*.json", { eager: true, import: "default" })';
  return {
    name: "parity-public-examples-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[/\\]src[/\\]examples[/\\]index\.ts$/.test(id)) return undefined;
      if (!code.includes(PRIVATE_GLOB))
        this.error("src/examples/index.ts no longer has the private glob tests/parity/vitest.config.ts empties");
      return code.replace(PRIVATE_GLOB, "{}");
    },
    load(id) {
      if (/[/\\]examples[/\\]private[/\\]/.test(id)) this.error("the parity harness must not load src/examples/private");
      return undefined;
    },
  };
}

export default defineConfig({
  ...app,
  plugins: [publicExamplesOnly(), ...(app.plugins ?? [])],
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
