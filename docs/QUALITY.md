# Quality loop

Every feature batch goes through the same gates before the next one starts:

1. **Build:** feature agents work in their lanes (`docs/PLAN.md`) with unit + e2e tests.
2. **Verify:** `pnpm check` (typecheck, lint, unit, e2e) and `pnpm build`.
3. **Code review:** `pnpm review` runs seven Codex reviewers in parallel on the changes since
   `review-base` (correctness, architecture, performance, tests, security, accessibility, types; prompts in
   `scripts/review/angles/`). Findings are structured JSON merged into `.reviews/<stamp>/REPORT.md`.
4. **Triage & fix:** P0/P1 are fixed (with a regression test each); P2 are fixed when cheap or ticketed in
   `docs/BACKLOG.md`; false positives are noted. Then `git branch -f review-base HEAD`.
5. **UX gate:** a designer agent reviews the app against `docs/UX-PRINCIPLES.md` and simplifies.

Standards: strict TypeScript, ESLint (typescript-eslint strict, react-hooks, jsx-a11y), Prettier,
`data-testid` selectors, deterministic tests, coverage reported in CI (`pnpm test:coverage`).

## E2E ports

`pnpm test:e2e` starts its own servers: the Vite dev server on `E2E_PORT` (default 5191) and, for the
sub-path project, `vite preview` of a production build on `E2E_PREVIEW_PORT` (default 5193). Pick other
ports to run beside another checkout, e.g. `E2E_PORT=5301 E2E_PREVIEW_PORT=5303 pnpm test:e2e`.

A server already listening is reused only when you chose its port explicitly, or locally on the default
port. CI never reuses one, so it can't silently test a server from another checkout.
`E2E_SKIP_PREVIEW=1` skips the production-build server.

## CI

`.github/workflows/ci.yml` runs in parallel jobs:

- **checks:** `tsc`, `pnpm lint`, `pnpm test:coverage`, `pnpm build`, then `pnpm size`.
- **e2e 1/3, 2/3, 3/3:** the Playwright suite split with `--shard`. Chromium is cached by Playwright
  version and the pnpm store by lockfile. When a shard fails, it uploads its HTML report and traces
  (`playwright-output-<n>`), and **e2e-report** merges every shard's blob report into one HTML report
  (`playwright-report-merged`).

A newer push to the same branch cancels the running workflow. `CI=true` keeps its meaning: Playwright retries
and two workers, longer Vitest timeouts, and scaled perf budgets (`src/test/perfBudget.ts`).

## Accessibility

`tests/e2e/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA) on every main view and overlay, in both
themes. Fix what it finds in the app. Exclude a rule only for third-party markup that can't be fixed,
narrowly (selector and rule), with a comment saying why.

## Bundle size

`pnpm size` (after a build) fails if the main entry chunk's gzip size exceeds the budget in
`scripts/bundle-budget.mjs`, set at about 15% over the measured size. Raise it on purpose, in the change
that needs it, and say why.
