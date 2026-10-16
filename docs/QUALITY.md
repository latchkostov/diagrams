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

## Toolchain

| Tool               | Pin                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Node               | 24.22.0 in `.nvmrc` (CI/nightly); `engines` requires Node 24; Docker uses `node:24-alpine`                    |
| pnpm               | 12.11.2 in `packageManager`; the shared `.github/actions/toolchain` action reads that pin                     |
| Type checker       | TypeScript 7.0.2 as `@typescript/native`; its `tsc` runs `typecheck`, builds and Vitest's type checks         |
| TypeScript API     | `typescript` aliases `@typescript/typescript6` 6.0.2 (reports compiler 6.0.3); `tsc6` runs `typecheck:legacy` |
| Test/browser tools | Vitest + coverage 5.0.4, Playwright 1.64.1; browser parity uses the corresponding `-noble` image              |
| App/lint/build     | React 19.3.1, typescript-eslint 8.71.2; Vite resolves to 8.3.4 in the lockfile                                |
| CI OS              | `ubuntu-26.04`, explicitly pinned in CI and nightly                                                           |

Bump these separately: measure first, update the manifest and regenerate the lockfile, then test a
clean `pnpm install --frozen-lockfile` on CI. Keep the API compiler within typescript-eslint's peer
range; run `pnpm typecheck:legacy` when changing either compiler. The compiler regression test checks
valid/invalid code and no emit with both. `pnpm-workspace.yaml` owns build permissions (`esbuild` only)
and makes stale installs fail before commands run; pnpm 12's isolated hoisting defaults stay unchanged.
The one-day release-age default remains, with exact-version exceptions for the requested patches
published on 2026-10-14; remove those once aged. Cache the path from `pnpm store path` (currently store
v11), not an assumed v10 location. Change Node in `.nvmrc`, `engines` and Docker together. Run full
parity without rewriting goldens, check bundle size, and refresh the skill viewer if `skill:check`
warns. Measurements and migration decisions: [toolchain modernization](TOOLCHAIN-MODERNIZATION.md).

## E2E projects and ports

### Full local push gate

After committing, run `bash scripts/verify-push.sh 6360` (or the installed
`bash /c/Users/latch/bin/verify-push.sh 6360` copy). Choose an unused five-port range;
5190 and 6000 are forbidden. Install updates by copying the versioned script to that path;
the installed script also works in older checkouts without this runner file.

Full gates queue across worktrees of this repository. The key comes from their shared Git
metadata: a native named mutex on Windows, `flock` on Linux. The OS owns the lock, so a failed
or terminated gate cannot leave a stale PID lock behind. This prevents simultaneous unit
worker pools, builds and browsers from starving one another. Three concurrent gates on the
Windows host reached 96% CPU and stalled otherwise healthy page startup/input for 10–25 seconds.
The queue regression holds one fake gate at a barrier, proves the second cannot enter, then
verifies that a failed first gate releases the second. Assertions and test timeouts stay intact.

The gate runs lint, typecheck, formatting, units, build, entry size and parity, then every
whole-file E2E shard against the production bundle. It uses three browser workers, like CI,
and zero retries. Local Playwright otherwise starts half the logical CPUs' worth of workers:
on a 32-thread Windows machine that means sixteen concurrent browsers.
It sets `E2E_CHROMIUM_ONLY=1`: the same `chromium` test selection, with only its app server.
The unused dev, subpath, internal and locked servers otherwise also start for each shard;
the dev watcher observes the accumulated trace/export HTML even though no test uses it.
Normal Playwright runs keep all five projects and their servers.

Gate mode (`E2E_GATE=1`) disables server reuse for every Playwright webServer, even
with explicit ports, and forbids focused tests. Before running checks, the gate probes
all five reserved ports on IPv4/IPv6 loopback and fails with the occupied port and a
remedy. Playwright also rejects a server that appears after preflight. Both initial
and final cleanliness checks reject nonignored untracked files; gitignored local files
remain allowed. A rerun invalidates its earlier stamp before these checks.

The gate builds the `VITE_E2E=1` bundle once, after the ordinary production build, then
sets `E2E_PREBUILT=1` for all six shards. An inherited prebuilt setting is discarded;
a failed fresh build skips shards and cannot stamp HEAD. The final unchanged-HEAD and
clean-tree checks still apply. Vitest gets `--allowOnly=false` and Playwright gets
`--forbid-only`, independently of the caller's CI setting.

The full-suite gate also caught the flow-building selection helper returning before
the inspector's deferred reveal finished. Following it immediately with Alt+arrow
could overlap viewport commands and measure a node outside the pane. The helper now
waits for the inspector and stable viewport before the next gesture. A regression
holds the reveal's clock until selection publishes, then verifies the selected node
is in the pane when the helper returns. Removing the waits fails that boundary
assertion. Placement, connection, direction and Undo assertions stay unchanged.

Failures do not stop the remaining checks or shards. Every shard reports passed, failed,
flaky and skipped totals from Playwright's JSON report, including a non-zero exit or missing
report as a gate failure. Logs, HTML reports, screenshots and traces stay in separate
`tests/.output/local-gate/<run>/shard<N>/` directories, so the next shard/run cannot overwrite
the evidence. Run directory names stay short: Chrome on Windows cannot open an offline
export at MAX_PATH even when Node can read that same file. A platform-independent path
budget regression reserves room for a long per-test folder and nested export.
A final `SUMMARY:` line gives the complete totals. Only a complete success
stamps the unchanged, clean HEAD in Git's `verified` directory; starting a rerun removes
its earlier stamp. The orchestration tests replace commands with fakes and verify all six
shards run after an earlier failure, without starting browsers or servers.

The two compiler probes and the full 5,000-node Draw everything case have explicit 40-second
hang backstops on every machine, matching CI's intent. The compiler probes are separated by
compiler; the cap case is separated from the small import. They assert compatibility,
no emission and the real import cap, rather than performance. Complexity tests retain their
ratios and operation counts; the ordinary local unit timeout remains five seconds.
The import column guard counts internal array element reads, including copies, with the
same eighth-input comparison and 24x limit. It needs only two layouts rather than timing
150 layouts and their fresh maps; garbage collection cannot change the measured work.
The startup-readiness regression fast-forwards the fake clock while Live is paused;
an animation-frame counter prevents accidentally replaying thousands of irrelevant paused frames.
Playback still delivers every simulation tick and retains all readiness assertions.

Windows Chromium test browsers also disable `TcpPortRandomizationWin`. A standalone tiny
loopback page reproduced `ERR_NO_BUFFER_SPACE`, with the netlog recording Windows error
10055 at TCP connect before HTTP. Across both probe orders, default Chromium 156.0.8078.4
had one connect failure in 4,800 navigations; disabling the feature had none in 4,800.
The host had ample free memory and available ephemeral ports, and used CUBIC. No Windows
network/antivirus settings, app code, error assertions or retries are changed.
`scripts/e2e-chromium.ts` reads the pinned Playwright runtime's native default feature list
without launching a browser. Chrome honors only the last `--disable-features` switch, so
appending a bare workaround would silently re-enable Playwright's other disabled features.
The config regressions catch removal of the workaround and clobbered defaults; Linux/macOS
launch arguments stay unchanged. Review/remove this deliberately narrow internal API
integration when upgrading Playwright/Chromium; it must never enter an app bundle.

`pnpm test:e2e` starts its own servers and runs three Playwright projects:

| Project    | What it tests                                                                  | Server                            |
| ---------- | ------------------------------------------------------------------------------ | --------------------------------- |
| `chromium` | every spec except the two below                                                | `E2E_PORT` (default 5191)         |
| `dev`      | tests that need the Vite dev server (`DEV_ONLY` in `playwright.config.ts`)     | the dev server                    |
| `subpath`  | `subpath.spec.ts`: the real production build embedded under `/tools/diagrams/` | `E2E_PREVIEW_PORT` (default 5193) |

`E2E_TARGET` picks what `chromium` runs against:

- `build` (the default on CI): `vite preview` of a production build made with `VITE_E2E=1`. That flag keeps
  the dev-only test hooks (the `?storage=test` provider, the Lab, which production builds don't have) and nothing else, so
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

Every server listens on `127.0.0.1`, and Chrome resolves `localhost` there (`LOOPBACK` in
`playwright.config.ts`): Vite otherwise bound `localhost` to `[::1]` on some machines while Chrome sometimes
connected to `127.0.0.1`, and a request now and then failed with `net::ERR_CONNECTION_REFUSED`.

Pick other ports to run beside another checkout. A server already listening is reused only when you chose
its port explicitly, or locally on the default port. CI never reuses one, so it can't silently test a
server from another checkout.

Only builds with `VITE_E2E=1` may contain the test hooks: `noTestHooks` in `vite.config.ts` fails any other
build that bundles the test storage provider, so `pnpm build` on CI proves production is clean.

## CI

`.github/workflows/ci.yml` (all jobs start together unless noted):

- Runs on master pushes, `ci/**` pushes (platform trials without opening a PR), and pull requests.
- **Detect changes:** reads the changed files through the GitHub API (no checkout). It skips the e2e
  matrix when a pull request or push touches only `docs/**`, `*.md` or `LICENSE`, and on a push to
  `master` whose tree a pull request run already passed (a squash merge of a PR tested against the current
  `master`). If `master` moved in between, the tree differs and everything runs.
- **Types, lint, unit, build:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:coverage`, `pnpm build`
  (with the test-hook and private-example guards), then `pnpm size`. Runs on every event, beside e2e.
- **E2E 1/6 … 6/6** (after Detect changes): the Playwright suite in six shards of whole spec files, three
  workers each (the runners have 4 vCPUs). The local action `.github/actions/e2e` (shared with the nightly
  workflow, so both test the same setup) builds the e2e and production bundles while apt installs Chromium's
  system libraries (on cache hits and misses), then runs the shard with `E2E_PREBUILT=1`. The pnpm store
  is cached by lockfile and workspace policy, Chromium by Playwright version, OS and architecture through
  `.github/actions/chromium-cache` (also used by self-host smoke tests). Each shard writes its slowest tests, slowest spec files and any test that
  needed a retry to the job summary, and uploads the JSON report (`e2e-durations-<n>`, 30 days) for
  timing analysis. On failure it uploads its HTML report and traces (`playwright-output-<n>`), and
  **Merged E2E report** merges every shard's blob report into one (`playwright-report-merged`).
- **Output parity:** `pnpm parity` (docs/PARITY.md) on every event: what the app produces from a diagram
  (simulations, checks, exports, imports, agent tools, layout, languages, the canvas, images, Interactive HTML)
  against committed goldens. The browser tier runs in Playwright's Linux image through Docker, as it does locally.
  Update the goldens with `pnpm parity:update` when a change means to alter output.
- **Self-host image and chart:** the root and subpath Docker smoke tests, Caddy validation, `helm lint`
  and an ingress/TLS chart render. Uses the same cached Chromium as the e2e shards.
- **CI:** the one check to require for merging. It passes when every job that had to run passed; a
  skipped e2e matrix counts as passed. On a passing pull request run it uploads a
  `ci-tested-tree-<tree>` marker, which the merge's push run looks up to skip the matrix.

Shards are balanced by measured time, not by test count. `scripts/e2e-shard.mjs` deals the spec files out
longest first, each to the least loaded shard, using the seconds per file in `tests/e2e-timings.json`.
Inside a shard, `fullyParallel` spreads the tests over the workers. Playwright's own `--shard` splits by
test count in file order, which put the slow specs together: two shards ran 35 to 55 s longer than the rest.
A spec file missing from the timings counts as an average one. Setup and builds cost every shard about the
same (35 to 40 s), so only test time needs balancing. Refresh the timings from the latest pull request run
when the shards' wall times drift apart, or after adding, speeding up or splitting a slow spec. Use runs
of the current code: averaging in older runs left the first balanced split 54 s apart, because specs had
since got faster or slower.

```sh
gh run download <run-id> -p 'e2e-durations-*' -D /tmp/durations
node scripts/e2e-shard.mjs --update /tmp/durations/*/results.json
node scripts/e2e-shard.mjs --plan 6   # each shard's files and projected seconds
```

Keep single tests short: a shard can't finish before its longest test. Split a long sweep into parts
(`lab.spec.ts` and `layout.spec.ts` take every Nth preset or fixture per test) rather than raising its timeout.

A newer push to the same branch cancels the running workflow. `CI=true` keeps its meaning: Playwright
retries (2), three workers and `E2E_TARGET=build`, and longer Vitest timeouts. Retries keep a flaky test from
blocking a merge, but the job summary lists every test that needed one: treat those as bugs.

### Nightly

`.github/workflows/nightly.yml` runs every night (04:23 UTC) and on demand (Actions › Nightly › Run
workflow). It covers what pull requests skip for speed, with no retries:

- **Dev server 1/4 … 4/4:** the whole suite with `E2E_TARGET=dev`: the `chromium` and `dev` projects on
  the Vite dev server, and `subpath` on the production build. Checks of the e2e build itself skip
  (`E2E_TARGET` in `tests/e2e/fixtures.ts`).
- **Build ×3 1/6 … 6/6:** the production-build suite, as on pull requests, with `--repeat-each=3`. A test
  that fails once in three runs is a flake.

When any of them fails, **Report failure** opens an issue labelled `nightly-failure` (creating the label
if needed), or, when one is already open, replaces its body and comments on it. The body lists each failed
test with how many of its runs failed and the first error line (`scripts/e2e-failures.mjs`), and links the
run. It uses the workflow's `GITHUB_TOKEN` with `issues: write` in that job only (`contents: read`
elsewhere). Close the issue once the cause is fixed. Each job uploads its JSON report
(`nightly-results-<suite>-<n>`), and its HTML report and traces when it fails.

## Timing in tests

No test asserts a budget in milliseconds: a busy machine or CI with coverage fails it, and a retry hides it. What
a timing test guards decides its form:

- **Complexity** (it must stay linear): compare two sizes in the same run, never a clock. The small input is an
  eighth of the large (`GROWTH_FACTOR`), and the ratio must stay under 24 (`LINEAR_LIMIT`: linear is about 8,
  quadratic 64), or 192 (`QUADRATIC_LIMIT`) for work that is quadratic by design. `growth()` in
  `src/test/complexity.ts` warms up, repeats calls too short to time, interleaves the sizes and takes the fastest
  of several runs. `GROWTH_LOG=1` (with `--silent=false`) prints each ratio. When the library's own time (YAML or
  JSON parsing) would hide ours, parse once and time the rest (`kubernetes.test.ts`, `terraform.test.ts`).
- **Better still, count the work**: reads (`countingReads()`, a Proxy), calls (`vi.spyOn`), searches, rebuilds.
  Counts don't depend on the machine, and they see a regression a ratio can't (an index rebuilt per lookup is
  linear in the diagram too).
- **Hostile input** (ReDoS, alias bombs, deep nesting, budgets): prove the bound itself. The limit's error is
  thrown, the reads stop at the cap, the serialiser never sees the object, or a ratio shows the pattern is linear
  (keep hostile sizes small enough that a quadratic pattern fails the ratio in seconds: a backtracking regex
  blocks the thread, and Vitest's timeout can't stop it). An absolute ceiling only as a hang backstop, at the
  test timeout's scale.
- **Real time** (frames, input, animation): compare with a baseline in the same run (keystrokes with checks held
  against running; the worker renderer's main-thread work per page frame against the main-thread fallback's, all
  of it, from Chrome's own task time in thread CPU time, not only animation callbacks), or count frames and logic
  (transforms over 20 frames, not 500 ms; a page clock paused at the drop proves a toast went because of Undo, not
  its expiry). Pause a page clock where it stands with `pauseClock()` (`tests/e2e/fixtures.ts`): a `pauseAt()` a
  margin ahead races a clock that runs in step with real time until paused.

Every conversion is checked by a deliberate regression (make it quadratic, remove the bound) that the test must
catch. An e2e test that clicks must wait for the layout it clicks into (a panel opening, a pan, a lazily loaded
menu), not for time. A page opened in live view (`live=1`, `sim=`) waits for its live session with `gotoLive()`: the
session's code loads on first use, after the canvas's, and takes seconds on a busy dev server (nightly #78).
Measuring performance itself (workloads to 5,000 nodes, timings as trends, gates for ratios, counts and bundle sizes, a
committed baseline and the ranked hotspots) is the benchmark suite's job: `pnpm bench`, `pnpm bench:gates`, docs/BENCHMARKS.md.

## Accessibility

`tests/e2e/a11y.spec.ts` runs axe-core (WCAG 2.0/2.1 A and AA) on every main view and overlay, in both
themes. Fix what it finds in the app. Exclude a rule only for third-party markup that can't be fixed,
narrowly (selector and rule), with a comment saying why.

## Bundle size

`pnpm size` (after a build) fails if the main entry chunk's gzip size exceeds the budget in
`scripts/bundle-budget.mjs`, set at about 15% over the measured size. Raise it on purpose, in the change
that needs it, and say why.

What isn't needed for the first view loads on first use or on intent, through the two helpers in
`src/lib/lazyLoad.tsx` (`lazyComponent`, with `preload()` for hover, menu-open and idle prefetch, and
`loadOnce` for plain modules): the import and export dialogs, the draw.io and Mermaid converters, image
export, password links, Your diagrams, the embed viewer, the live session (simulation, slow motion,
recording), the AI panel and the Lab. Until its code arrives a dialog shows its modal frame, which Esc and
Close cancel; a failed download says so in place, with Retry (`tests/e2e/lazy-loading.spec.ts`). The canvas
loads as two chunks (`canvasChunks` in `vite.config.ts`). `src/lib/bundleSplit.build.test.ts` builds the
app and fails if any of that reaches the startup JavaScript (the entry and what it preloads) or the canvas's
first view, or if the canvas splits into more chunks. `scripts/perf/startup.mjs` measures paint, time to
interactive and the first open of the File menu, the dialogs, Ctrl+K, quick-add, the AI panel and live view on
a production build, at a CPU and network throttle (`--cold`: each on a fresh page as soon as it's up).

## A1 bookkeeping invariants

`src/sim/resourceInvariants.ts` is an opt-in ownership oracle. Ordinary playback does not execute it.
`autoscaling.invariants.test.ts` checks every internal 10 ms simulation step across 200 deterministic
small diagrams/event sequences: bursts, broker retries and refusals, pause/resume, live resource
removal/re-enabling, concurrency edits (including saturated lowering/replacement attempts), HPA edits and fractional downscale.
Refused timeline actions are a no-op: runner and engine state stay identical, and the next successful
step matches a checkpoint replay without the refused attempt. It independently counts ready/starting/draining
identities, checks reservations against live attempts, exact-fleet baseline plus in-flight memory,
queued/staged cleanup, finite metrics, preserved paused deadlines and the run-wide sampled CPU-part
budget. Sampled memory is a declared time-integrated estimate; its numerical state must stay finite,
and continuous retained retries must retain their memory occupancy through backoff and subsequent
attempts. The generator also compares planning capacity to an independently computed CPU execution
ceiling, including services with admission settings.

Failures print the seed, scale, diagram and reduced events (including explicit `unset` keys). Reduction
removes event chunks, then individual events, then unneeded nodes. Events are 1-minimal for the failing
invariant, not guaranteed globally shortest. Replay one seed with `A1_FUZZ_SEED=3 pnpm exec vitest run
src/sim/autoscaling.invariants.test.ts`. `A1_FUZZ_NIGHTLY=1` expands to 5,000 seeds in the nightly workflow.
Keep new bookkeeping transitions in this generator as well as adding focused regressions.

A3 adds a second generator in the same file: 140 seeds (5,000 with `A1_FUZZ_NIGHTLY=1`) cycle through the seven
cloud presets (ECS CPU, ALB and step; Container Apps HTTP and event; App Service; Cloud Run) with shortened
clocks, so alarms, cooldowns, flapping deferral, on-demand wakes and scale to zero all happen within a run.
Events add disabling mid-run, fixed overrides followed by `resumeAutoscaling`, refusals and pause/resume. The
oracle additionally checks that ECS never scales in on missing data or inside a scale-in cooldown, a Monitor
rule never acts inside its cooldown or against its direction, request wakes come only from request scalers,
and every delivery queued at a node holds its group slot (what lets request metrics count waiting pushed
requests without scanning the queue). A clamp of a resumed override to the range bound is the range's move, not
the policy's. Replay one with `A3_FUZZ_SEED=61 pnpm exec vitest run src/sim/autoscaling.invariants.test.ts -t A3`.
Minimal reproductions the nightly run finds are kept in `tests/fixtures/autoscaling/a3-nightly-repros.json` and
replay on every run.

## R1 routing invariants

`src/sim/routing.invariants.test.ts` is request routing's seeded fuzzer: 200 seeds (5,000 with `A1_FUZZ_NIGHTLY=1`)
generate random request routes, shares or rates mixes, ordered tables with overlapping exact, prefix and template
rules, hosts, headers and query, Defaults or none, type and request filters, deny rules, rule quotas, outages,
pauses and edits mid-run (tables, mixes and rates replaced). After every action it checks that the routes' sent
counts add up to what the source sent, that every router decision is the first matching rule (or Default) and a
positive-weight target its filters accept, that refusals carry the right reason and add up by reason and by
route, that no route finishes more than it sent, and that the drained run holds nothing. Each seed plays twice
for determinism, and forty replay from a mid-run checkpoint. Replay one with
`R1_FUZZ_SEED=12 pnpm exec vitest run src/sim/routing.invariants.test.ts`.

The same file checks shared buckets at a managed router (60 seeds, 1,000 nightly): random endpoints and rules
name a shared account in random overlaps, and naming it again on a rule whose every request already comes through
an endpoint that charges it must change nothing, in playback (the gateway's and its route's counts) or in the
analysis (capacity, utilization, downstream demand). A shared bucket is charged exactly once per admitted request,
per endpoint and matched action.

It also generates normalization refusals (200 seeds, 5,000 nightly): unknown token/bytes costs at API or
endpoint scope, unresolved shared concurrency and undeclared runtime endpoints, with multiple routes,
endpoints, quota-bearing matched rules and Defaults. Every diagram must validate, analyze without throwing,
report zero usable gateway capacity and expose its refused route demand. A focused mixed-endpoint case
keeps rejected calls out of the rule ledger while preserving the accepted sibling's budget/readout.
