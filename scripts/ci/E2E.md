# E2E CI setup and measurements

The required checks keep their names: `E2E 1/6` through `E2E 6/6`,
`Types, lint, unit, build`, and `CI`. No merge-tool configuration change is needed.
`Build E2E variants` is an additional prerequisite covered by the existing `CI` aggregate.

CI builds the e2e and preview variants once, plus the internal/locked variants when
their spec files are selected. The same-run `e2e-builds` artifact contains only those
dist directories. Every shard downloads it into `tests/.output`, checks the variants
it needs, and serves them with `E2E_PREBUILT=1`. A missing artifact fails the run;
shards never rebuild to hide a missing producer output. Each shard still serves only
the self-host variants selected by its own spec list.

The producer resolves the Playwright container tag from the installed lockfile-pinned
package, so a dependency update does not require a second version pin. Chromium and
system libraries come from that image; the CI shards skip browser cache restoration
and apt. Nightly keeps the action's default local-build/browser-install path, including
its dev target and independent self-host selection. See the upstream
[Playwright Docker instructions](https://playwright.dev/docs/docker).

## Refresh duration estimates

Download all six `e2e-durations-*` artifacts from a successful, representative CI run
of the current suite. Refresh explicitly and review the committed map:

```sh
gh run download <run-id> -p 'e2e-durations-*' -D tests/.output/durations
node scripts/e2e-shard.mjs --update tests/.output/durations
node scripts/e2e-shard.mjs --plan 6
```

Use a fresh download directory per run. The directory argument works in PowerShell
without shell glob expansion. The updater averages each test's successful first
attempt, excludes retries and failed/skipped attempts, preserves previous values
for uncovered files, and drops deleted specs. Do not mix runs from different suite
revisions. When any current spec lacks a valid estimate, the planner falls back to
a deterministic file-count split and prints a warning. A complete map enables
longest-first greedy bin-packing; each whole spec belongs to exactly one shard.

## Compare runs

Record a baseline on the PR before changing the shard setup, then an optimized run
on the same PR. Download the jobs API responses after the runs finish:

```sh
gh api repos/latchkostov/diagrams/actions/runs/<before-id>/jobs > tests/.output/before-jobs.json
gh api repos/latchkostov/diagrams/actions/runs/<after-id>/jobs > tests/.output/after-jobs.json
node scripts/ci/e2e-timings.mjs tests/.output/before-jobs.json tests/.output/after-jobs.json
```

The table reports all six shard job durations, the elapsed E2E path after change
detection (including the producer and runner queues), and the overall path from
the first job start to completion of the `CI` aggregate. It refuses incomplete or
failed runs. Include both run links and any observed queue delay when reporting
results; shorter shard jobs alone do not prove a faster critical path.

JSON duration uploads, unique blob names, failure traces, and the merged failure
report retain their existing names and behavior.
