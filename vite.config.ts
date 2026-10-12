import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { exampleMetadataPlugin } from "./scripts/example-metadata";
import { skillAssetsPlugin } from "./scripts/skill-assets";
import { securityHeaders } from "./scripts/security-headers";

/**
 * `VITE_E2E=1` builds the app for the e2e suite: a production build that keeps the dev-only test hooks
 * (the `?storage=test` provider, the Lab tab). Every other build must leave them out.
 */
const E2E_BUILD = process.env.VITE_E2E === "1";

/** Fails a production build if anything from src/examples/private (local-only work diagrams) ships. */
export function noPrivateExamples(): Plugin {
  const isPrivate = (id: string) =>
    /[/\\]examples[/\\]private[/\\]/.test(id) || /[/\\]localOnly\.dev\.ts(?:\?|$)/.test(id);
  return {
    name: "no-private-examples",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const leaked = Object.entries(out.modules).filter(([id, m]) => isPrivate(id) && m.renderedLength > 0);
        if (leaked.length) this.error(`Local-only example or fingerprint data bundled into ${out.fileName}`);
      }
    },
  };
}

/** Fails a build that isn't the e2e build if a dev-only test hook ships (see E2E_BUILD). */
function noTestHooks(): Plugin {
  const isHook = (id: string) => /[/\\]interop[/\\]storage[/\\]testProvider\.ts$/.test(id);
  return {
    name: "no-test-hooks",
    apply: "build",
    generateBundle(_options, bundle) {
      if (E2E_BUILD) return;
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const hooks = Object.entries(out.modules).filter(([id, m]) => isHook(id) && m.renderedLength > 0);
        if (hooks.length || out.code.includes("Test storage"))
          this.error(`e2e-only test hooks bundled into ${out.fileName}; only VITE_E2E=1 builds may include them`);
      }
    },
  };
}

export default defineConfig({
  // Relative base so the build can be served from any sub-path (e.g. latchkostov.com/tools/diagrams/).
  base: "./",
  plugins: [
    exampleMetadataPlugin(),
    react(),
    noPrivateExamples(),
    noTestHooks(),
    skillAssetsPlugin(),
    // CSP and the other security headers on `vite preview`, exactly as vercel.json sends them. Not in dev.
    securityHeaders(),
  ],
  // Always defined, so `import.meta.env.VITE_E2E === "1"` folds to a constant and the hooks drop out.
  define: { "import.meta.env.VITE_E2E": JSON.stringify(E2E_BUILD ? "1" : "") },
  build: {
    // Icons are many small SVGs; serving them as cached files keeps them out of the main JS chunk.
    assetsInlineLimit: 0,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    // CI runners with coverage are several times slower; perf budgets scale too (src/test/perfBudget.ts).
    testTimeout: process.env.CI ? 40_000 : 5_000,
    css: { include: [/tokens\.css/] },
    typecheck: {
      enabled: true,
      tsconfig: "tsconfig.node.json",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.*", "src/examples/**", "src/lab/**", "src/test/**"],
      reporter: ["text-summary", "html"],
    },
  },
});
