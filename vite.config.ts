import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative base so the build can be served from any sub-path (e.g. latchkostov.com/tools/diagrams/).
  base: "./",
  plugins: [react()],
  build: {
    // Icons are many small SVGs; serving them as cached files keeps them out of the main JS chunk.
    assetsInlineLimit: 0,
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
