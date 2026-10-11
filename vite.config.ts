import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Fails a production build if anything from src/examples/private (local-only work diagrams) ships. */
function noPrivateExamples(): Plugin {
  const isPrivate = (id: string) => /[/\\]examples[/\\]private[/\\]/.test(id);
  return {
    name: "no-private-examples",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const leaked = Object.entries(out.modules).filter(([id, m]) => isPrivate(id) && m.renderedLength > 0);
        if (leaked.length)
          this.error(`private example(s) bundled into ${out.fileName}: ${leaked.map(([id]) => id).join(", ")}`);
      }
    },
  };
}

export default defineConfig({
  // Relative base so the build can be served from any sub-path (e.g. latchkostov.com/tools/diagrams/).
  base: "./",
  plugins: [react(), noPrivateExamples()],
  build: {
    // Icons are many small SVGs; serving them as cached files keeps them out of the main JS chunk.
    assetsInlineLimit: 0,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
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
