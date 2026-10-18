import type { GlobalParameters } from "fast-check";
import process from "node:process";

type Env = Record<string, string | undefined>;

/** Preserve each property's usual coverage while expanding all of them in Nightly. */
export function propertyRuns(usual: number, env: Env = process.env): number {
  const multiplier = Number(env.FC_RUN_MULTIPLIER ?? 1);
  if (!Number.isSafeInteger(multiplier) || multiplier < 1)
    throw new Error("FC_RUN_MULTIPLIER must be a positive integer");
  return usual * multiplier;
}

/** CI repeats one corpus; local runs and the explicit Nightly override explore new seeds. */
export function fastCheckConfig(env: Env): GlobalParameters {
  const requested = env.FC_SEED ?? (env.CI ? "20261018" : "random");
  const seed = Number(requested);
  if (
    requested !== "random" &&
    (!/^-?\d+$/.test(requested) || !Number.isInteger(seed) || seed < -2147483648 || seed > 2147483647)
  )
    throw new Error("FC_SEED must be a signed 32-bit integer or random");
  return {
    ...(requested === "random" ? {} : { seed }),
    ...(env.FC_PATH === undefined ? {} : { path: env.FC_PATH }),
    numRuns: propertyRuns(100, env),
  };
}
