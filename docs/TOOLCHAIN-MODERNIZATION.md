# Toolchain modernization — 2026-10-14

Baseline: `db7f9e50f9574d6572c8ee79555b8f83a669e29e` (master, PR #113).
Measurements were collected before changing dependencies, configuration or application code.
Times are elapsed seconds, including command startup; they are observations, not test budgets.

## Local baseline

Windows, 32 logical processors, 64 GiB RAM; checkout-local Node 22.23.3, pnpm 10.0.0,
TypeScript 5.9.3. The machine was not reserved exclusively for this benchmark.
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
