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

## E2E projects and ports

`pnpm test:e2e` starts its own servers and runs three Playwright projects:

| Project    | What it tests                                                                  | Server                            |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------- |
| `chromium` | every spec except the two below                                                | `E2E_PORT` (default 5191)         |
| `dev`      | tests that need the Vite dev server (`DEV_ONLY` in `playwright.config.ts`)     | the dev server                    |
| `subpath`  | `subpath.spec.ts`: the real production build embedded under `/tools/diagrams/` | `E2E_PREVIEW_PORT` (default 5193) |

`E2E_TARGET` picks what `chromium` runs against:

- `build` (the default on CI): `vite preview` of a production build made with `VITE_E2E=1`. That flag keeps
  the dev-only test hooks (the `?storage=test` provider, the Lab tab in the top bar) and nothing else, so
  the suite tests production React and the real bundle. The dev server then runs on `E2E_DEV_PORT`
  (default `E2E_PORT` + 1) for the `dev` project only.
- `dev` (the default locally): the Vite dev server on `E2E_PORT`, shared with the `dev` project. No build,
  so it's the quickest loop while you work.

Mark a test `@dev` (in its title, or `{ tag: "@dev" }`) only when it truly needs the dev server: it reads
React's development-only fiber timings or component names (`perf.spec.ts`), or imports source modules in
the page (`import("/src/...")`, as `library-regressions.spec.ts` does). Prefer `data-testid` and app
behaviour over either.

Run them locally:

- Like CI: `E2E_TARGET=build E2E_PORT=5301 E2E_PREVIEW_PORT=5303 pnpm test:e2e` (builds both bundles first).
- One project: add `--project=chromium`, `--project=dev` or `--project=subpath`.
- `E2E_SKIP_PREVIEW=1` skips the `subpath` project and its production build.
- `E2E_PREBUILT=1` serves `tests/.output/e2e-dist` and `tests/.output/preview-dist` as they are (CI builds
  them in an earlier step).

Pick other ports to run beside another checkout. A server already listening is reused only when you chose
its port explicitly, or locally on the default port. CI never reuses one, so it can't silently test a
server from another checkout.

Only builds with `VITE_E2E=1` may contain the test hooks: `noTestHooks` in `vite.config.ts` fails any other
build that bundles the test storage provider, so `pnpm build` on CI proves production is clean.

## CI

`.github/workflows/ci.yml` (all jobs start together unless noted):

- **Detect changes:** reads the changed files through the GitHub API (no checkout). It skips the e2e
  matrix when a pull request or push touches only `docs/**`, `*.md` or `LICENSE`, and on a push to
  `master` whose tree a pull request run already passed (a squash merge of a PR tested against the current
  `master`). If `master` moved in between, the tree differs and everything runs.
- **Types, lint, unit, build:** `tsc`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`, `pnpm build`
  (with the test-hook and private-example guards), then `pnpm size`. Runs on every event, beside e2e.
- **E2E 1/6 … 6/6** (after Detect changes): the Playwright suite in six shards of whole spec files, three
  workers each (the runners have 4 vCPUs). Each shard builds the e2e and production bundles while apt installs
  Chromium's system libraries, then runs with `E2E_PREBUILT=1`. The pnpm store is cached by lockfile and
  Chromium by Playwright version. Each shard writes its slowest tests, slowest spec files and any test that
  needed a retry to the job summary, and uploads the JSON report (`e2e-durations-<n>`, 30 days) for
  timing analysis. On failure it uploads its HTML report and traces (`playwright-output-<n>`), and
  **Merged E2E report** merges every shard's blob report into one (`playwright-report-merged`).
- **CI:** the one check to require for merging. It passes when every job that had to run passed; a
  skipped e2e matrix counts as passed. On a passing pull request run it uploads a
  `ci-tested-tree-<tree>` marker, which the merge's push run looks up to skip the matrix.

Shards are balanced by measured time, not by test count. `scripts/e2e-shard.mjs` deals the spec files out
longest first, each to the least loaded shard, using the seconds per file in `tests/e2e-timings.json`.
Inside a shard, `fullyParallel` spreads the tests over the workers. Playwright's own `--shard` splits by
test count in file order, which put the slow specs together: two shards ran 35 to 55 s longer than the rest.
A spec file missing from the timings counts as an average one. Refresh the timings when the shards' wall
times drift apart, or after adding or splitting a slow spec:

```sh
gh run download <run-id> -p 'e2e-durations-*' -D /tmp/durations
node scripts/e2e-shard.mjs --update /tmp/durations/*/results.json
node scripts/e2e-shard.mjs --plan 6   # each shard's files and projected seconds
```

Keep single tests short: a shard can't finish before its longest test. Split a long sweep into parts
(`lab.spec.ts` and `layout.spec.ts` take every Nth preset or fixture per test) rather than raising its timeout.

A newer push to the same branch cancels the running workflow. `CI=true` keeps its meaning: Playwright
retries (2), three workers and `E2E_TARGET=build`, longer Vitest timeouts, and scaled perf budgets
(`src/test/perfBudget.ts`). Retries keep a flaky test from blocking a merge, but the job summary lists
every test that needed one: treat those as bugs.

## Accessibility

`tests/e2e/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA) on every main view and overlay, in both
themes. Fix what it finds in the app. Exclude a rule only for third-party markup that can't be fixed,
narrowly (selector and rule), with a comment saying why.

## Bundle size

`pnpm size` (after a build) fails if the main entry chunk's gzip size exceeds the budget in
`scripts/bundle-budget.mjs`, set at about 15% over the measured size. Raise it on purpose, in the change
that needs it, and say why.
