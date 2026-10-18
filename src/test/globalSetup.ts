import process from "node:process";
import type { TestProject } from "vitest/node";
import { createTempRun } from "../../scripts/test-temp.mjs";

export default function setup(project: TestProject) {
  const run = createTempRun("vitest");
  const saved = Object.fromEntries(Object.keys(run.env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, run.env);
  // Explicit config env covers both forks and worker threads, including already constructed pool options.
  project.config.env = { ...project.config.env, ...run.env };
  return () => {
    try {
      run.dispose({ checkOwned: true });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
    }
  };
}
