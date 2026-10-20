import { acquireBudget } from "./gate/budget.mjs";
export function withSweepBudget<T>(
  options: { root: string; jobs: number; count: number; branch: string },
  run: () => Promise<T>,
  reserve?: typeof acquireBudget,
): Promise<T>;
