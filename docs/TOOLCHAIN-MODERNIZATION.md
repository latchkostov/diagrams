# Toolchain modernization — 2026-10-14

Baseline: `db7f9e50f9574d6572c8ee79555b8f83a669e29e` (master, PR #113).
Measurements were collected before changing dependencies, configuration or application code.
Times are elapsed seconds, including command startup; they are observations, not test budgets.

## Local baseline

One developer workstation (not reserved for the benchmark); checkout-local Node 22.23.3, pnpm 10.0.0,
TypeScript 5.9.3. Compare these timings only with runs on the same machine.
Each command ran serially, three times. Installs used dependency-only directories under
`tests/.output/toolchain`, containing copies of the same package manifest and lockfile:
each cold sample had empty `node_modules` and its own empty store; warm samples repeated
an installed fixture with the same store. This avoids deleting the working installation or
using another checkout. Package-manager bootstrap and Node downloads are excluded.

Unit runs used an ignored config overlay that applies the parity harness's existing
public-example-only plugin to the normal unit configuration. All normal unit files and
type checks still run. No application source was changed for the benchmark.
Parity ran both tiers, with warm Docker volumes and Playwright's `v1.64.0-noble` image
(its Node runtime is 24.21.0). The image, browser and rendering environment are separate
from the host's Node version.

| Command                                | Samples (seconds)      | Median | Result                       |
| -------------------------------------- | ---------------------- | -----: | ---------------------------- |
| `pnpm install --frozen-lockfile`, cold | 9.309, 8.701, 9.440    |  9.309 | Passed                       |
| `pnpm install --frozen-lockfile`, warm | 0.306, 0.299, 0.286    |  0.299 | Passed                       |
| `pnpm typecheck`                       | 16.303, 10.624, 12.691 | 12.691 | Passed                       |
| `pnpm lint`                            | 22.865, 22.129, 28.594 | 22.865 | Passed                       |
| `pnpm test` (config overlay above)     | 31.354, 26.533, 31.664 | 31.354 | Third run failed; see below  |
| `pnpm build`                           | 10.753, 15.678, 14.580 | 14.580 | Passed                       |
| `pnpm parity`                          | 53.461, 63.773, 80.355 | 63.773 | Second run failed; see below |

An additional three unit samples with the repository's existing `CI=true` settings
took 38.787, 45.371 and 41.294 seconds (median 41.294). The first two passed; the
third failed the import-layout complexity check (ratio 25.49 against limit 24).
Use these same settings for the after comparison; neither timeouts nor complexity
limits were edited.

Baseline failures, before any upgrade:

- The third unit run timed out in `src/interop/uniqueIds.test.ts`'s compose import test.
  The first two runs passed all 490 files (6,358 tests passed, four skipped), with no type errors.
  A fourth diagnostic run (31.752 seconds) had seven startup timeouts and a worker-fixture
  failure after a timed-out test; it is outside the original three-sample table.
- The second parity run differed in the dark HTML viewer's viewport for `kafka-order-pipeline`:
  scale `0.62963` became `0.630798`, changing its drawn-geometry and screenshot goldens.
  The first and third runs matched all 1,425 goldens. No golden was rewritten.

The tables include failed attempts rather than silently selecting faster successful runs.
Do not interpret small local differences as statistically significant speedups.

## CI baseline

Read with `gh run list --branch master --workflow ci.yml --status success --limit 5`
and `gh run view <id> --json jobs`. A job's wall time is `completedAt - startedAt`,
excluding queue time; skipped jobs do not contribute a zero. The last five green master
runs at collection time were:

| Run                                                                             | Types/lint/unit/build | Output parity | Self-host image/chart | Detect changes |   CI gate |
| ------------------------------------------------------------------------------- | --------------------: | ------------: | --------------------: | -------------: | --------: |
| [38672679250](https://github.com/latchkostov/diagrams/actions/runs/38672679250) |                   239 |           135 |                    92 |              2 |         7 |
| [38671650343](https://github.com/latchkostov/diagrams/actions/runs/38671650343) |                   239 |           117 |                    85 |              3 |         4 |
| [38667676796](https://github.com/latchkostov/diagrams/actions/runs/38667676796) |                   239 |             — |                    81 |              4 |         4 |
| [38666761349](https://github.com/latchkostov/diagrams/actions/runs/38666761349) |                   144 |             — |                     — |              2 |         4 |
| [38663331790](https://github.com/latchkostov/diagrams/actions/runs/38663331790) |                   234 |             — |                     — |              4 |         4 |
| **Median (samples)**                                                            |           **239 (5)** |   **126 (2)** |            **85 (3)** |      **3 (5)** | **4 (5)** |

All five skipped e2e (docs-only changes or already-tested merge trees). Some jobs did not
exist in the earlier runs. These are the requested master medians, not a complete sample
of today's workflow. For the shard investigation, the latest five green full PR runs were
collected separately; their code is not identical, so this is a historical reference,
not an isolated experiment:

| Run                                                                                    |   E2E 1 |   E2E 2 |   E2E 3 |   E2E 4 |   E2E 5 |   E2E 6 |
| -------------------------------------------------------------------------------------- | ------: | ------: | ------: | ------: | ------: | ------: |
| [38673071376](https://github.com/latchkostov/diagrams/actions/runs/38673071376) (#113) |     251 |     434 |     515 |     253 |     345 |     241 |
| [38670080490](https://github.com/latchkostov/diagrams/actions/runs/38670080490)        |     300 |     429 |     505 |     328 |     277 |     217 |
| [38666920211](https://github.com/latchkostov/diagrams/actions/runs/38666920211)        |     325 |     412 |     466 |     312 |     315 |     207 |
| [38665961106](https://github.com/latchkostov/diagrams/actions/runs/38665961106)        |     309 |     449 |     477 |     336 |     350 |     272 |
| [38665885875](https://github.com/latchkostov/diagrams/actions/runs/38665885875)        |     376 |     371 |     447 |     356 |     366 |     262 |
| **Median (5)**                                                                         | **309** | **429** | **477** | **328** | **345** | **241** |

The slowest shard's median is 477 seconds. The existing action already caches Chromium
and the pnpm store. Its timing file lacks 43 of the current 84 spec files; they all receive
an average weight, despite very different actual costs. Refreshing those measurements
is the first candidate for a safe CI improvement.

## Local result

Same machine and commands, now Node 24.22.0, pnpm 12.11.2 and native TypeScript 7.0.2.
Three serial samples per command; unit tests use `CI=true` on both sides of this comparison,
with the same public-example-only overlay. Parity uses four workers on both sides, with warm
Docker volumes. Every after sample passed. The installation fixtures now include the workspace
policy and the new compiler dependencies. Bootstrap downloads remain excluded.

| Command                | Before median | After samples          | After median | Change |
| ---------------------- | ------------: | ---------------------- | -----------: | -----: |
| Cold frozen install    |         9.309 | 8.242, 10.852, 9.714   |        9.714 |  +4.4% |
| Warm frozen install    |         0.299 | 0.108, 0.104, 0.104    |        0.104 | −65.2% |
| Typecheck              |        12.691 | 1.054, 1.225, 1.058    |        1.058 | −91.7% |
| Lint                   |        22.865 | 15.196, 19.944, 15.343 |       15.343 | −32.9% |
| Unit tests (`CI=true`) |        41.294 | 17.440, 20.380, 17.341 |       17.440 | −57.8% |
| Production build       |        14.580 | 3.247, 3.576, 3.223    |        3.247 | −77.7% |
| Full parity            |        63.773 | 45.191, 48.501, 43.259 |       45.191 | −29.1% |

Cold installs did not get measurably faster. Small install differences and the noisier lint/parity
results should not be over-interpreted on a shared machine. The compiler gain is also measured
separately, interleaving both compilers on the upgraded Node/pnpm installation:

| Compiler, both app and parity configs | Samples             | Median |
| ------------------------------------- | ------------------- | -----: |
| Native TypeScript 7                   | 1.002, 1.038, 0.996 |  1.002 |
| TypeScript 6 reference                | 8.385, 8.421, 8.343 |  8.385 |

That paired comparison is **8.4× faster**, independent of the Node/pnpm baseline change.

## CI result

Three complete green attempts at `94428e91c2ec52d16f019228b778161c67bb8c77`:
[attempt 1](https://github.com/latchkostov/diagrams/actions/runs/38678179132/attempts/1),
[attempt 2](https://github.com/latchkostov/diagrams/actions/runs/38678179132/attempts/2),
[attempt 3](https://github.com/latchkostov/diagrams/actions/runs/38678179132/attempts/3).
All times are job wall seconds, excluding queue time, using the same definition as the baseline.
The first run populated the new browser-cache key; repeats confirmed pnpm store v11 and Chromium
cache hits. The runner identifies itself as Ubuntu 26.04.1; Playwright installed dependencies
without an unsupported-OS fallback.

| Job                       | Before median (samples) | After attempts 1, 2, 3 | After median |
| ------------------------- | ----------------------: | ---------------------- | -----------: |
| Types/lint/unit/build     |          239 (5 master) | 189, 128, 200          |          189 |
| Output parity             |          126 (2 master) | 124, 132, 113          |          124 |
| Self-host image/chart     |           85 (3 master) | 110, 67, 92            |           92 |
| Detect changes            |            3 (5 master) | 4, 4, 4                |            4 |
| CI gate                   |            4 (5 master) | 2, 2, 5                |            2 |
| E2E 1/6                   |         309 (5 full PR) | 290, 362, 350          |          350 |
| E2E 2/6                   |         429 (5 full PR) | 284, 329, 298          |          298 |
| E2E 3/6                   |         477 (5 full PR) | 381, 377, 293          |          377 |
| E2E 4/6                   |         328 (5 full PR) | 369, 363, 363          |          363 |
| E2E 5/6                   |         345 (5 full PR) | 354, 390, 347          |          354 |
| E2E 6/6                   |         241 (5 full PR) | 296, 381, 356          |          356 |
| Slowest shard in each run |         477 (5 full PR) | 381, 390, 363          |          381 |
| Shard spread in each run  |         259 (5 full PR) | 97, 61, 70             |           70 |

The checks job is **20.9% faster**, and the full matrix's slowest shard **20.1% faster** than the
historical medians. Shard spread fell 73%. Assignments changed, so individual shard numbers now
carry different work; their critical path and spread matter more than a per-index speedup.
The initial upgraded, unbalanced trial's slowest shard was 506 seconds; the optimized median is 381.
Coverage, projects, workers and retries stayed intact: all 1,097 browser tests ran each time.
Attempts 1 and 2 each had one pre-existing quick-add retry; attempt 3 passed all 1,097 immediately.

Parity was essentially flat (126 → 124 seconds), and self-hosting was **8.2% slower** (85 → 92).
The cache restoration works, but these samples do not establish a job-level self-host speedup.
CI hardware/network variation and the historical baseline's changing job set limit attribution:
the table measures the complete upgrade, not an isolated Ubuntu or Node experiment. The paired
local compiler comparison above is the cleaner attribution of the TypeScript gain.

## Upgrades and compatibility

- Patched React/React DOM to 19.3.1, Playwright to 1.64.1, Vitest/coverage to 5.0.4,
  and typescript-eslint to 8.71.2. The React patch required refreshing the packaged skill viewer;
  the plugin is 1.1.19, exactly one patch above the baseline master.
- Node 24.22.0 is shared through `.nvmrc` by CI, nightly and the e2e action, including nightly's
  reporting script. `engines` bounds development to Node 24; Docker uses `node:24-alpine`.
  The Node upgrade's parity run matched all 1,425 goldens, including Intl output.
- pnpm 12.11.2 uses `pnpm-workspace.yaml`: the existing esbuild-only build permission becomes
  `allowBuilds`, isolated hoisting defaults remain, and commands fail on stale dependencies
  (`verifyDepsBeforeRun: error`). The regression test disables the fix and confirms failure.
  Cache paths come from pnpm's actual store (v11), keyed by lockfile and workspace policy.
  Docker copies the policy before install; parity's container uses `pnpm_config_store_dir` and
  bootstraps the manifest's pinned package manager. The regenerated lockfile adds pnpm's own
  package-manager dependency document. See the [migration guide](https://pnpm.io/migration),
  [pnpm 11 notes](https://pnpm.io/blog/releases/11.0) and
  [pnpm 12 differences](https://pnpm.io/blog/whats-different-in-pnpm-12).
- The new default one-day release-age policy rejected five requested packages published that day.
  Exact-version exceptions cover React/React DOM 19.3.1 and Playwright/test/core 1.64.1;
  all other packages retain the default. These exceptions can be removed once those releases age.
- TypeScript follows Microsoft's [supported side-by-side setup](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
  `@typescript/native` aliases TypeScript 7.0.2 (`tsc`), while `typescript` aliases the compatibility
  package `@typescript/typescript6` 6.0.2 (`tsc6`; its bundled compiler/API reports 6.0.3).
  This keeps typescript-eslint and the geometry tests' compiler API working. Both compilers pass
  the app and parity configs. A permanent test checks valid code, two assignment errors and no emit.
  A temporary unused, incorrectly typed variable failed `pnpm typecheck`, `typecheck:legacy` and
  lint; both compilers reported identical TS2322/TS6133 diagnostics. Lint caught the unused binding:
  this repository's syntax-based lint config does not duplicate semantic type checking. The only
  observed compiler difference was an error exit code of 1 versus 2; scripts accept any nonzero failure.
- All CI/nightly jobs use Ubuntu 26.04. Playwright's
  [supported platforms](https://playwright.dev/docs/intro#system-requirements) include it, and the
  initial CI trial passed all six e2e shards, Docker parity, and the self-host image/chart job.
  The trial failed only the new offline policy fixture: its manager pin unnecessarily needed registry
  metadata absent on a fresh runner. The fix removes that fixture pin and gives it an empty cache/store;
  temporarily restoring the pin reproduces `ERR_PNPM_BAD_CONFIG_DEP` locally.

## CI improvements and decisions

The six reports from master-equivalent PR #113 refresh all 84 spec timings (43 previously missing).
Every spec is assigned exactly once. Using those same measured costs for both assignments:

| Assignment | Shards' total test seconds (before worker parallelism) |
| ---------- | ------------------------------------------------------ |
| Old        | 600.8, 1056.4, 1352.5, 616.5, 883.5, 566.0             |
| Refreshed  | 848.2, 843.8, 847.1, 846.5, 846.1, 844.0               |

The shared Chromium cache now includes OS, architecture and Playwright version, and also serves
the self-host smoke job. System dependencies install on every job; both cold and warm e2e jobs
overlap apt with their existing production builds. Test coverage, projects, workers and retries
are unchanged. `ci/**` push runs allow these trials without opening a PR.

Deliberately deferred:

- Node 26 remains Current. Its [scheduled LTS transition is 2026-10-28](https://github.com/nodejs/Release/issues/1152);
  retest the toolchain and Docker bootstrap then, before moving the LTS pin.
- Replacing the TypeScript API with version 7: typescript-eslint's peer range is `<6.1.0` and
  TypeScript 7 has no compatible API. The supported dual installation avoids a parser workaround.
- Switching parity's rendering image from Noble: the runner OS can change while the pinned browser
  environment keeps the goldens comparable. No golden has been re-recorded.
- Sharing build artifacts across shards: the existing builds overlap apt, while stale shard weights
  explain the main critical-path imbalance. Another build job plus artifact transfer adds a dependency
  and needs a separate measured trial; no unproven gain is claimed here.
- Saving/loading the large Playwright Docker image through Actions cache: transfer and extraction
  costs need measurement against MCR's pull before adding another cache. Chromium was already cached
  for e2e, so the implemented extension targets the self-host job instead.
- Test-isolation changes, fewer browsers/projects, fewer retries or lower coverage: none was needed.
  The existing jsx-a11y 6.10.2 peer warning about ESLint 10 remains; lint passes, and no peer override
  hides it.

## Verification

- Three after runs of typecheck, lint, the full unit suite, production build and full parity passed.
  Vitest reports 494 files, 6,362 passing tests, four skipped, and no type errors (including its
  type-test instances). Every one of the 1,425 parity goldens stayed unchanged; none was re-recorded.
- `pnpm typecheck:legacy` also passed both app and parity configs. The deliberately invalid source
  was removed after verifying native/reference compiler and lint failures. The install-policy test
  fails with automatic installation restored; the cold-cache test fails with the old fixture pin restored.
- `pnpm i18n check` passed with zero errors and existing translation warnings. `build:internal`
  passed. Public entry gzip is 103.9 kB and internal 103.4 kB against the 123.5 kB budget (84%).
  The startup-chunk test passed in the unit suite. `pnpm skill:check` reports a current viewer.
- Local self-host smoke passed Caddy validation and root/subpath containers, including non-root
  operation, headers/CSP/CORS, immutable caching, gzip, SPA fallback and browser routing. Local Helm
  3.14.2 passed lint and ingress/TLS rendering (only the existing optional icon recommendation).
- Production e2e used ports 6270–6274 with `VITE_E2E=1` for the app sample: live, sim-truth, imports,
  i18n and presentation (177 tests). 176 passed immediately; one import test passed on retry after
  Chromium reported Windows `ERR_NO_BUFFER_SPACE` while loading an asset. Three isolated repeats
  with retries disabled then passed. A separate production run passed all 18 internal/locked
  self-host tests. An ignored config overlay omitted the unused dev server; the hosted CI suite
  retains every project. All servers and smoke containers started locally were stopped.
- The first hosted Ubuntu 26.04 trial passed every browser shard, parity and self-hosting, but failed
  the new offline test fixture. That was fixed and reproduced with a negative control before rerunning
  CI. This failed run is excluded from successful-run medians, not hidden as a toolchain success.
- The first optimized full CI run had one quick-add connection-label retry, also present in baseline
  PR #113. This and the baseline fit/complexity flakes are recorded in [the backlog](BACKLOG.md).
- The full nightly repeat matrix was not dispatched. Its shared setup and the CI suite's dev project
  were exercised by the three full runs; the nightly schedule and repetition policy remain as before.

No application controls or flows changed, so the UX review found no new chrome or disclosure choices.
No user-facing simulation, planning or stencil feature was added, and no showcase or release-note
entry is needed for this infrastructure change.
