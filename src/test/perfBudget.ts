// Wall-clock budgets in tests guard against complexity regressions, not machine speed. CI runners with
// coverage instrumentation run several times slower, so budgets scale there (override with PERF_BUDGET_SCALE).
type Env = Record<string, string | undefined>;

export function perfBudget(ms: number): number {
  const env: Env = (globalThis as { process?: { env: Env } }).process?.env ?? {};
  const scale = Number(env.PERF_BUDGET_SCALE ?? (env.CI ? 8 : 1));
  return ms * (Number.isFinite(scale) && scale > 0 ? scale : 1);
}
