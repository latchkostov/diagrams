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

### Portable local gate

Run `pnpm gate setup` once per checkout, then `pnpm gate doctor`. Both work in PowerShell,
cmd, Git Bash and POSIX shells without shell utilities. Setup installs frozen repo dependencies,
pinned Chromium and the pinned Playwright Docker image; it never installs system software.
Doctor explains how to fix Node/pnpm pins, missing installs, Docker access and low disk space.
Both the OS temp drive and repository drive need at least 8 GiB free.

After committing, run `pnpm gate full --ports 6480`. Omit `--ports` to find a free five-port
range in 6400–6999. The gate checks IPv4 and IPv6 loopback, never reuses an existing server,
and rejects any range containing 5190 or 6000. A socket lock shared by all worktrees queues
other gates; process death releases the lock without stale files on Windows, macOS or Linux.

Full runs lint, typecheck, formatting, i18n and skill checks, unit coverage, production build,
entry size, output parity, then every CI Playwright project: chromium, dev, subpath, internal
and locked. The four independent E2E builds run together with CI's environments. One Playwright
invocation runs all specs with `--retries=0 --forbid-only`; there are no sequential shards.
CPU and RAM determine workers (measured cap 12); `--workers N` overrides the formula.

`pnpm gate quick [spec...]` runs static checks, Vitest tests related to files changed since
the merge-base with origin/master, and only the explicit or changed E2E specs on production
builds. It warns if origin/master is ahead. `--only unit,e2e` selects categories and includes
their build dependencies. `--repeat N` repeats the entire E2E invocation back to back.

`pnpm gate full --linux` exports exactly HEAD into a Linux volume and runs in the installed
Playwright version's noble image. Dependencies use a platform/architecture/lock-hash volume;
a pnpm store is shared. Reports return to the checkout. Both parity tiers run in that same
container (no nested Docker). The image's Node runtime is intentional; installation disables
engine-strict inside the image. Native parity retains its existing Linux browser tier.
`GATE_LINUX_SOURCE=bind` is a diagnostic comparison mode; full archive runs exclude all ignored
and untracked host content. Archive transport avoids host bind-mount overhead.

Native Playwright/Chrome temporary profiles use the run's own directory on the repository drive.
In Linux profiles and reports use native volumes. Reports are copied back after the run,
avoiding parallel browser trace writes through the host filesystem mount.
Short paths under `tests/.output/g/` preserve Windows's file URL path budget. Each step has
a log; JSON/HTML reports, screenshots and traces persist per repetition. The final timing
table and `SUMMARY:` line include units, goldens and per-project browser counts.

Full requires a clean tree (including nonignored untracked files), invalidates an earlier
stamp, and checks that HEAD and the tree stayed unchanged. Only complete successful runs
write `$(git rev-parse --git-common-dir)/verified/<sha>`. Quick, subsets and `--no-docker`
never stamp. `--no-docker` loudly skips Docker checks and browser parity for native CI runners.

| Platform/mode           | What it predicts                                       | When to use it                                 |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Windows native          | Windows Chromium, native file paths and shortcuts      | Daily Windows work and portability checks      |
| macOS native            | macOS Chromium, Command shortcuts and native fonts     | Daily macOS work and portability checks        |
| Linux native            | Installed Linux Chromium and local dependencies        | Daily Linux work and portability checks        |
| Any host with `--linux` | CI's pinned Linux browser image and Linux dependencies | Before pushing and to reproduce Linux failures |

`pnpm test:e2e` starts its own servers and runs five Playwright projects:

| Project    | What it tests                                                                  | Server                             |
| ---------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| `chromium` | every spec except `@dev` and the specs with their own builds                   | `E2E_PORT` (default 5191)          |
| `dev`      | tests that need the Vite dev server (`DEV_ONLY` in `playwright.config.ts`)     | the dev server                     |
| `subpath`  | `subpath.spec.ts`: the real production build embedded under `/tools/diagrams/` | `E2E_PREVIEW_PORT` (default 5193)  |
| `internal` | `self-host.spec.ts`: branded internal production build                         | `E2E_INTERNAL_PORT` (default 5194) |
| `locked`   | `self-host-locked.spec.ts`: production with every privacy switch enabled       | `E2E_LOCKED_PORT` (default 5195)   |

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

Canvas interaction measurements open the Inspector and fit the diagram before counting renders.
Selecting a node normally opens the Inspector and pans to keep that selection and its connections visible;
an unrelated node may then lie outside the narrower pane. A test switching to that node must first fit
or pan it into view, rather than force a click through the sheet. Keep panel/camera setup outside
performance measurements.
The first #145 audit covered selection clicks but missed screen boxes reused across a pointer-up.
The second CI failure's trace shows the caption measured before the Inspector's selection pan finished;
the return gesture used that stale box. The sheet occupies its own flex column, rather than overlaying
the canvas. A screen box is still invalid after that column opens and the camera pans.

For repeated coordinate gestures, open the Inspector and fit all endpoints before measuring, or wait
for its reveal and pan, then remeasure every endpoint. Locator visibility alone does not prove that a
coordinate is uncovered. Keep deliberate tests of the deferred reveal on a fake clock; do not disable
the Inspector globally, force clicks, enlarge the viewport or replace pointer coverage with a nudge.

The follow-up sweep selects whole specs with `mouse.`, `dragTo(`, `boxOf(`, canvas test ids or node,
annotation, boundary, edge and handle test ids, and runs their `chromium` and `dev` projects against
`E2E_TARGET=build`, Node 24.22.0 and ports 6400–6404 at the configured CI viewports. The audit includes:

| Interaction                                         | Resolution                                                                                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Caption drags after selection or Escape             | Open the sheet and fit both endpoints before measuring; cover 1280×800 and 1440×900, a deferred reveal and unchanged caption dimensions. |
| Alt-drag of a selection frame                       | Wait for the sheet and pan, then remeasure both cards and zoom; cover the default and a remembered wide sheet.                           |
| Drawing-basics box selections and boundary resizing | Existing reveal/viewport waits and remeasurement remain; intentional back-to-back drags use a fake clock.                                |
| Flow building and multiple unrelated selections     | The selection helper waits for the reveal; existing fits bring subsequent targets into the narrowed pane.                                |
| Annotation handles, read-only views and Lab drags   | Handles are measured after selection settles, or no Inspector opens.                                                                     |
| Development-project interactions                    | The benchmark prepares its pane before measurement; other cases use a single selection or synthetic fixtures.                            |
| Subpath, locked and internal projects               | Subpath and locked have no canvas-node clicks; internal selects only its initial target, with subsequent actions in menus.               |

No default width or canvas-layout change is needed for these stale-coordinate failures. The UX review
keeps the reserved canvas space and selection reveal, and checks both compact and CI-sized viewports.
Temporarily removing the caption preparation reproduces the CI colour failure at 1440px. Reusing the
old selection-frame boxes after a manual pan and a wide-sheet reveal prevents the copies from being
created. Restoring the preparation and remeasurement passes both regressions.

The third #145 CI failure exposed a second constraint: even a fresh box can start outside the pane.
After selecting an edge, the selection pan can leave an unrelated node near the left edge; the
selection box's corner, 14 px farther left, then falls on the stencil rail. The pinned Linux container
reproduces the missing-node selection. Waiting for the pan alone failed all five repetitions.
Use `waitForSelectionSettled()` before measuring after selection: it waits for the Inspector reveal,
the canvas size and the viewport. If the next gesture targets an unrelated object, fit all endpoints
with `fitDiagram()` before measuring, including the empty canvas where a box drag starts.
The edge-preservation cases cover both 1280×800 and 1440×900 with default and remembered wide sheets.
Removing their preparation reproduces the failure without weakening selection or pointer coverage.

The full Linux sweep also caught the embed stream test treating HTTP server writes as browser reads.
TCP buffers can accept extra writes before cancellation reaches the server. The fixture now sends
9 MB (past the 8 MB limit) and holds the response open: the test requires `too_large` and connection
closure before EOF. This proves bounded reading and cancellation without a network-throughput budget.
Removing `reader.cancel()` fails the connection-closure assertion, and restoring it passes.
Keep unit compiler probes out of a running dev sweep: creating/removing their temporary tsconfig files
clears Vite's module cache and forces reloads. Refresh the optimizer before the isolated final sweep;
do not weaken the `devReloads` fixture to hide them.
Install a page clock before navigation when it must control every autosave timer. A timer scheduled
before a late installation can still run while the fake clock is paused. The serialization-count
test settles selection, pauses the already-installed clock and observes the edited node before
measuring `pagehide`; its exact count remains one.
The admission playback test likewise installs its clock before Live mounts, then restarts at zero
before advancing it. Rejections must come from controlled simulation progress, never traffic that
happened to run before the pause.
The final #145 Linux sweep runs both complete projects with four workers and `--retries=0`:
1,438 Chromium plus 50 dev cases pass, with zero failures, flaky cases or skips.

The expanded dev sweep also covers the image-clone resource tests brought in from master. After a
rebase introduces new deep imports, rescan a previous checkout's optimizer cache with `pnpm dev --force`
before sweeping: its stale dependency list can otherwise reload active test pages on first use.
The resource tests pass after that rescan with the original Vite configuration; no prebundle override
or relaxation of the existing `devReloads` fixture is needed.

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

- **Native portability:** Windows and macOS run `pnpm gate full --no-docker --only unit,e2e`,
  including all five browser projects. Reports feed the same failure issue.
  [Dated portability audit](design-review/2026-10-17-portable-gate.md).

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

The benchmark harness's off-pane regression uses one geometry-derived middle drag to move a card
fully beyond the pane, then exercises the app's Fit action. Reusing an 80-frame benchmark pan for
setup consumed 20–22 seconds in CI: the whole-test timeout interrupted the final settle check,
sometimes only 2 ms after it started. That did not establish a stuck `data-fit-pending` request.
Keep the fit readiness wait and off-pane/hit-test assertions; frame-paced performance workloads
belong in the benchmark suite. The original setup also fails at 4× browser CPU throttle in the
two-CPU Linux container, which provides a same-configuration check of the shorter gesture.

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

Large image exports wait on the progress phase and success toast within the whole-test hang backstop,
then check the observed download's completion. The action timeout is not an export-duration budget.
The cancelled-load retries and decode-progress regression keep a 4× CPU throttle to exercise slow CI
rendering locally, but use 45 nodes: their held requests/decode promise guarantee the boundary under test.
The 300-node workload belongs to the separate responsiveness and byte-parity tests. Combining it with
the throttle made healthy retries exhaust the 90-second whole-test backstop on Linux (#142);
waiting on success within that backstop alone did not fix it. A live dim attribute likewise precedes
the opacity transition: poll the rendered opacity when asserting the visual result, rather than
sampling it immediately after the attribute.

The collaboration export regression holds a macrotask only after the rendered progress bar
reports a value above 0% and below the clone phase's 70% boundary. SVG paint preparation can
yield at 0% on a slower machine, before cloning starts; holding the first MessageChannel
unconditionally caught that preparation yield on Linux (#143). The test lets React publish
progress on an animation frame before deciding whether to hold the continuation, then waits
for the peer's edit to appear before releasing it. No elapsed-time wait or timeout increase
is needed.

The isolated-context relay drops outgoing packets from detached test pages before announcing
their departure. A heartbeat sent after disconnect must never reach the other editor; the
recovery regression counts received packets as well as checking its saved-on-device status.
Otherwise the status can briefly pass before a late heartbeat reconnects the departed peer.

### Linux reproduction

Use `pnpm gate full --linux --ports 6480`. For a focused reproduction use
`pnpm gate quick tests/e2e/image-slices.spec.ts --linux --only e2e --repeat 5 --ports 6480`.
Playwright owns and stops its servers; the gate removes its container and temporary source volume.
No hand-written Docker or Bash command is needed.

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
