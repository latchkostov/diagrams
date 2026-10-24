import { defineConfig, mergeConfig } from "vitest/config";
import vite from "./vite.config";
import { operationProbes } from "./scripts/operation-probes";

const include = ["src/**/*.test.ts", "src/**/*.test.tsx", "services/server/test/**/*.test.ts"];

export default mergeConfig(
  vite,
  defineConfig({
    test: {
      coverage: {
        provider: "istanbul",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.*", "src/examples/**", "src/lab/**", "src/test/**"],
        reporter: ["text-summary", "html", "json", "json-summary"],
      },
      projects: [
        {
          extends: true,
          plugins: [operationProbes()],
          test: { name: "unit", include, exclude: ["**/*.heavy.test.ts"] },
        },
        {
          extends: true,
          test: {
            name: "heavy",
            include: ["src/**/*.heavy.test.ts"],
            fileParallelism: false,
            maxWorkers: 1,
          },
        },
      ],
    },
  }),
);
