# Performance benchmarks

A benchmark suite for Live Diagrams: deterministic workloads from 100 to 5,000 nodes, the scenarios people feel
(opening, panning, typing, dragging, live view, checks, planning, imports, exports), a trustworthy baseline, gates that
catch regressions in CI without flaking, and a ranked list of hotspots for the refactoring round.

```sh
pnpm bench            # everything: about 2½ hours on a fast desktop; writes tests/.output/bench/{results.json,summary.md}
pnpm bench:gates      # the gates only (complexity ratios, render and operation counts, leaks, bundle): about 3 minutes
pnpm bench:quick      # every scenario at 100 and 500 nodes, one run each: a quick look while working
pnpm bench:node       # the Node suites (engine, checks, planning, layout and routing, imports, exports)
pnpm bench:ui         # the browser suites (Playwright on the production e2e build)
pnpm bench:sim        # the simulation: engine and live view, Node and browser
pnpm bench:bundle     # the shipped bundle's composition and budgets
pnpm bench:compare base.json head.json [--md out.md] [--fail-on-regression]
```

`pnpm bench` builds what it serves, so it runs on a clean checkout. To compare a branch with master, run it on both
and compare the two `results.json`, or compare against the committed baseline (`tests/bench/baseline/master.json`).

Contents: [Design](#design) · [Workloads](#workloads) · [Metrics](#metrics) · [Method and noise
control](#method-and-noise-control) · [Gates and report-only](#gates-and-report-only) · [Output](#output) ·
[CI](#ci) · [Baseline](#baseline) · [Hotspots](#hotspots) · [Proving the gates](#proving-the-gates) ·
[Extending](#extending)

## Design

Three questions shaped the suite:

1. **What does a person wait for?** Opening a diagram, the first frame of a pan, each key typed into a name, each frame
   of a drag, a minute of live view, a check run, an export. Those are measured end to end in a real Chromium on the
   production build, from the input event to the painted frame.
2. **What does the code do that grows with the diagram?** The reviews kept finding whole-graph work on every keystroke
   or tick. Timings at four sizes show the curve; counts (renders per keystroke, analyses per selection, edges routed per
   drag frame) show the cause, whatever the machine.
3. **What can fail a pull request without crying wolf?** Only what doesn't depend on the machine: ratios measured in
   the same process (`growth()`), counts, and bytes. Milliseconds are trends, compared normalised against a calibration
   run on the same machine at the same moment, never gated.

It follows the repository's own rules for timing in tests (`docs/QUALITY.md` § Timing in tests): no budget in ms,
complexity as a ratio of two sizes, counts where the work can be counted, and every gate proven by a deliberate
regression it catches. It complements the output-parity harness (`docs/PARITY.md`): parity proves a refactor changes
no output, the benchmarks show what it made faster and that nothing got slower in the ways that can be gated.

Layout:

| Where                         | What                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/bench/workloads/`        | Workload generators (pure, seeded, type-checked with the app; `workloads.test.ts` in `pnpm test`)                              |
| `tests/bench/node/`           | Node suites (Vitest, `tests/bench/vitest.config.ts`): engine, checks, planning, layout, imports, exports                       |
| `tests/bench/ui/`             | Browser suites (Playwright, `tests/bench/playwright.config.ts`): load, interactions, renders, live, features, memory, profiles |
| `tests/bench/*.ts`            | Shared: the results contract (`results.ts`), the calibration workload, the workload cache                                      |
| `scripts/bench/`              | `run.mjs` (orchestration), `build.mjs`, `bundle.mjs`, `report.mjs`, `compare.mjs`                                              |
| `tests/bench/baseline/`       | The committed baseline: `master.json` and its summary `master.md`                                                              |
| `.github/workflows/bench.yml` | Nightly full run and the pull-request gates job                                                                                |

No app code changed for this. The only instrumentation the browser suites read is what the e2e build already exposes
(`window.__checks`, `__planning`, `__simulations`); render counts come from a stand-in React DevTools hook installed by
the test, on a second build of the same code with `output.keepNames` (see [Render counts](#render-counts)).

## Workloads

Six families, each a pure function of the node count with a fixed seed: the same diagram on every run and every
machine. Every result records its workload's node and edge counts and a fingerprint (FNV-1a of the exact JSON).

| Family      | What it is                                                                                                                                                                                                                                                                                                                                                                                                  | Exact size |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `mesh`      | A service mesh behind gateways: clients → edge gateways → one ingress per domain → services calling each other synchronously down a DAG, each with stores, a few topics read by the paired domain. One boundary per domain. Request-heavy, many long edges.                                                                                                                                                 | yes        |
| `pipeline`  | An event-driven pipeline in 12-node lanes: producer → Kafka ingest topic → enricher (its own group) → output topic read by two groups → work queue with competing workers and a DLQ (some with a replayer, some unread) → stores and sinks; some fan-in between lanes; four lanes per boundary. Two saved simulations (steady load; an incident with workers going down during a spike, with expectations). | yes        |
| `k8s`       | Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets, Strimzi topics, KEDA ScaledObjects, Ingress, a PostgreSQL StatefulSet per namespace) through the real importer, every boundary drawn.                                                                                                                                                                                                     | about      |
| `terraform` | A Terraform plan (`terraform show -json`) of order-processing slices on AWS (SNS, SQS with DLQ, Lambda, DynamoDB, Secrets Manager, IAM, EventBridge) through the real importer.                                                                                                                                                                                                                             | about      |
| `annotated` | The pipeline with a boundary per lane, a zone and a title per domain, a note per lane and a connectable shape per ten nodes (with a documentation edge to it).                                                                                                                                                                                                                                              | yes        |
| `examples`  | The public examples saved as `diagrams/v1` (`src/examples/*.json`), copied onto a grid until the size is reached (a v2 example's planning model, with its shared quota ids, belongs to one document). The inspector planning scenario reads every public example as saved.                                                                                                                                  | yes        |

Sizes: **100, 500, 1,500 and 5,000** nodes (5,000 is the file format's limit). The imported families solve for the
number of units that draws about that many nodes. The generators were written to look like real systems: call chains
a few services deep, not as deep as the diagram is wide; no request rings (a ring makes the capacity analysis run to its
iteration bound, which `planning/analyzeCapacity-withLoop` measures on its own); the importers' limits respected (a
compose file uses its shared anchor in 50 services at most: from about 100 aliases the YAML reader refuses the file as a
possible alias bomb).

Synthetic data only. The generators read `src/examples/*.json` through a glob that doesn't descend into
`src/examples/private/`, the bench Vitest config fails on any module that would load from it, and the browser suites
run production builds, which can't contain it.

Generating the biggest imported workloads takes seconds, so each one is written once to
`tests/.output/bench/workloads/<key>/<family>-<n>.json`, keyed by a hash of every source a generator can reach (all of
`src/` but its tests, the public examples included, and `pnpm-lock.yaml`; `src/examples/private/` is skipped unread). The browser suites read those files; `pnpm bench:prepare` writes them
before running a browser spec by hand.

## Metrics

Every metric has a stable id, `suite/scenario[/detail][/family@n]`. Times are milliseconds; the summary shows medians
with p90 beside them.

### Node suites (Vitest)

| Suite      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`    | `serialize` (save), `parseNative` (open: parse, migrate, validate), `toFlow` and `fromFlow` (the canvas's conversion both ways), file size                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `checks`   | `runChecks` (what the canvas runs in a worker after edits), `runSimulations` (Run simulations: every saved simulation played, with the losses it found)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `planning` | `analyzeCapacity` (behind the inspector's planning, the heat map and the capacity check) per family and size; `inspectorPlanning-keystroke` (the inspector's planning for one node recomputed as a keystroke in its label does) for legacy, P1, P2 and P3 files where the inspector offers it; `planningCompute` (the same past the inspector's work estimate, at 100 and 250 nodes); `explainEveryNode` (hover cards); `upgradePlanning` (to P3); `planningSignature`; `analyzeCapacity-withLoop`                                                                                                   |
| `sim`      | `engineLoad`; `liveFrame` (the live view's per-frame main-thread work: `LiveController.advance` and `snapshot` each frame, `publish` every 125 ms) at three message rates (x1 free play; x10 and x100 Traffic × at the same dot scale); `engineStep`, `engineFrame`, `engineSnapshot`; `savedSimulation` (a saved simulation played to the end)                                                                                                                                                                                                                                                      |
| `layout`   | `autoLayout` (layered layout), `tidyAll`, `tidySelection` (one boundary, the rest as obstacles), `routeAll` (every edge routed from scratch, with the route input the canvas itself assembles: `routeInputFromStore`, so notes and shapes are obstacles and shapes are edge ends), `routeDragFrame` (one node moved a few pixels with the router kept) and the edges it routed per frame. Routing isn't timed for the mesh and the Kubernetes import at 5,000 nodes (`routeSkipped`): a single call takes minutes there (one Kubernetes sample ran past 15), and the curve to 1,500 already shows it |
| `imports`  | Compose, Kubernetes, Terraform and AsyncAPI: `import` (what File ▸ Import draws by default), `importEverything` (Draw everything), `read` (the reader alone), source size                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `exports`  | `interactiveHtml` (with the build's real viewer template and icons), `drawio`, `mermaid`, `shareEncode`/`shareDecode` (share links), `thumbnail` (the library's, on every save)                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Browser suites (Playwright, production e2e build)

| Suite      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `load`     | Cold load in a fresh context: `firstNode` (navigation to the first frame with a node: first meaningful render), `settled` (the end of the last long animation frame, once three quiet seconds pass), `checksDone` (the first check run delivered; checks run by themselves up to 1,500 nodes), `firstNodeTimedOut` (nothing on screen in five minutes), main-thread task time and its script, style and layout parts, the longest frame and total blocking time, JS heap after GC, DOM nodes and listeners                                                                                                                                                                                                                                                                           |
| `interact` | `pan` (a middle-button drag: a left drag draws a selection box) and `zoom` (Control and the wheel: a plain wheel pans), each checked to have moved or scaled the viewport (main-thread ms per step, frame intervals, longest frame, input to next paint); `select` (a click to the frame the inspector shows the node; `select-first` unfolds the inspector); typing a node's name, its secondary line and a number in the inspector at a key every 120 ms (input to next paint per key, Event Timing's longest event per key, main-thread ms per key, check runs and planning analyses caused); `drag`. The pipeline and the mesh at every size they open in (the mesh stops at 1,500: at 5,000 it takes minutes to open and seconds a drag frame), the annotated pipeline at 1,500 |
| `renders`  | React commits and component renders per key, per click, per pan and drag frame, by component, and per second of live view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `live`     | Main-thread busy %, ms per frame, frame rate, particle frame rate and dots, with the particles drawn in the worker and on the main thread (`renderer=main`), at x1 and x10, turned on from a settled canvas (live view's frames never go quiet); heap and DOM over a minute of playback                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `features` | Auto-layout, Tidy up, Run simulations, PNG, SVG and Interactive HTML export, switching the language: input to done, main-thread time, longest frame                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `memory`   | DOM nodes, listeners and heap kept per open and close of the inspector, the command palette, the export dialog and live view                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `profile`  | CPU profiles (DevTools sampling profiler) of the slowest interactions, self time by function: the evidence behind [Hotspots](#hotspots)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Bundle

The shipped build (`pnpm build`'s, no test hooks), chunk by chunk: the entry, the startup JavaScript (the entry and
what `index.html` preloads), the canvas's first view (startup plus `CanvasView` and `canvas-shared`), live view's download (`LiveSession` and the chunks of its own it imports, beyond the canvas's),
every chunk's raw, gzip (level 9) and brotli size, and each chunk's biggest modules, so a comparison says what grew.

### How the browser numbers are taken

- **Input to next paint.** A capture listener on `keydown`, `pointerdown`, `wheel` and dragging `pointermove` takes the
  event's timestamp and asks for the next animation frame, which posts a message: the message runs after that frame's
  paint. Unlike Event Timing it has no 16 ms floor and no 8 ms rounding; Event Timing's longest event per interaction
  is recorded beside it (INP-style), counting an unreported key as 16 ms (an upper bound).
- **Main-thread time** comes from the DevTools `Performance.getMetrics` counters (task, script, style recalculation and
  layout durations) read around the interaction, so a frame's cost includes style, layout and paint, not just
  JavaScript.
- **Long animation frames** (`long-animation-frame`, with blocking duration) give the longest frame and total blocking.
- **Frame intervals** come from a `requestAnimationFrame` loop running during the gesture only.
- **Heap and DOM** are read after two forced garbage collections (`HeapProfiler.collectGarbage`), with
  `Runtime.getHeapUsage` and `Memory.getDOMCounters`.
- **Profiles** use `Profiler.start`/`stop` at a 200 µs sampling interval on the names build; the `.cpuprofile` files are
  kept in `tests/.output/bench/profiles` (open one in Chrome DevTools ▸ Performance ▸ Load profile).

### Render counts

React's production build calls a DevTools hook's `onCommitFiberRoot` on every commit when one is installed before
React loads. The stand-in hook (`tests/bench/ui/instrument.ts`) walks the committed fiber tree and counts the function
components that ran: a fiber rendered in this commit if it is new or carries the `PerformedWork` flag, and a subtree
React bailed out of is skipped (its child pointer is shared with the alternate tree, so its fibers and stale flags are
the previous commit's). Checked against React's development-only profiler timings on the dev server: the two methods counted the same 18,476 renders, component for component, for the same keystrokes on a 1,500-node diagram.

Names need the function names that minification removes, so the counts run on a second build of the same code with
Rolldown's `output.keepNames` (`scripts/bench/build.mjs`; no change to `vite.config.ts`). Timings never run on it. The
hook asserts it counted something, so a React upgrade that changed these internals fails loudly instead of reading zero.

## Method and noise control

| Concern              | What the suite does                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JIT and caches       | Warm-up calls before sampling (one for a call over 2 s); browser runs open a fresh context each run, so a cold load is cold                                                                                                                                                                                                                          |
| Timer resolution     | Node: a sample batches calls until it lasts 25 ms and divides; browser: input-to-paint and DevTools counters, not `Date.now()`                                                                                                                                                                                                                       |
| Garbage collection   | Node runs with `--expose-gc` and collects before every sample; browser heap readings collect twice first                                                                                                                                                                                                                                             |
| Outliers             | Several samples (Node 15, or 11 and 7 for the big sizes, fewer for calls over 5 s), medians, p90, CoV recorded                                                                                                                                                                                                                                       |
| Interference         | One process (Vitest `fileParallelism: false`, one fork) and one Playwright worker; Chromium's background throttling off                                                                                                                                                                                                                              |
| Pinned environment   | 1440 × 900, device scale factor 1, light theme, en-US, UTC, CPU throttle 2× on the main thread (`BENCH_CPU`)                                                                                                                                                                                                                                         |
| Determinism          | Seeded workloads with fingerprints; seeded simulations (`sim/determinism-checksum-delta` gates it); the engine and the live controller advanced with explicit time steps in Node (a fake clock that can't distort anything); Run simulations given a clock that never runs out (`now: () => 0`), so how much it plays doesn't depend on the machine  |
| Machines and runners | A same-run calibration ("cu"): a fixed JavaScript workload (sorting, Maps, strings, JSON) timed in the same Node process at each suite's start and end, and in a page at the same throttle; every time is also stored divided by its own suite's reading, the one closest in time (a shared machine's speed moved by half between suites of one run) |

Fake clocks stop where they would distort: the browser suites run on real time, because frames, input latency and the
live view's frame rate are what they measure (a page clock would also stop `requestAnimationFrame`).

**Why 2× and not 4×.** The repository's older perf scripts throttle 4×. At 4× the 5,000-node workloads take most of an
hour each to open and interact with; at 2× the whole suite runs overnight on a CI runner, and a few-ms keystroke is still
measurable. The calibration absorbs the difference between machines; the throttle sets how far below a fast desktop the
numbers sit.

### Measured variance

Measured on the baseline's machine, a 32-thread desktop shared with other work (as most developer machines and CI
runners are):

- **Within a run.** The coefficient of variation of a timing's samples: Node, median 11% (p75 16%, p90 23%, over 695
  timings); browser timings with three runs, median 12% (p90 54%: interactions on the big workloads, where one run in
  three meets a long frame the others don't).
- **The calibration moved too.** Between the Node suites of one run it read 9.7 to 14.9 ms: the machine's speed changed
  by half within an hour. That's why a time is normalised by its own suite's reading, not the run's.
- **Run to run, one commit.** A quick run twenty minutes after the baseline, compared with it: the normalised timings
  differed by a median of 21% (Node, several samples), 27% (browser, one run) and 14% (browser, three runs); p90 61%,
  106% and 46%. The raw timings differed as much (median 20%): the noise here is bursts of contention, not a uniformly
  slower machine, so normalising helps across machines more than across moments. With its thresholds (25%, or three
  times the samples' CoV; 50% for one run), `pnpm bench:compare` flagged 33 of 653 timings as slower: 5% false
  positives, which is why timings are a trend to read, never a gate.
- **Gates.** Three back-to-back `pnpm bench:gates` runs, the baseline and the repeat: every gate passed every time. The
  growth ratios moved by at most ±12% between runs (all 1.6× to 6× under their limits); bundle sizes and most counts
  didn't move at all; the render counts that did move moved by a stray commit (one in twelve keys), which the budgets
  leave room for and an extra render per key doesn't fit in.
- **Counts that aren't gated** move more: live view's renders per second follow its frame rate, and drag counts follow
  how many pointer events React batched into a frame (101 of 737 render counts differed in the repeat).

## Gates and report-only

A gate fails `pnpm bench:gates` (and the nightly run). Everything else is a trend.

| Gate                                                                                                                                                                                                                                       | Kind                                                                                      | Where       | Why it's robust                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Complexity of parsing, the canvas conversion, the checks, capacity analysis, the engine (load, frame, snapshot, idle tick), auto-layout, full routing (pipeline, 250 vs 2,000) and a drag frame's routing, every importer and every export | ratio, `growth()` at 500 vs 4,000 nodes (an eighth), under 24 (linear is 8, quadratic 64) | Node suites | Two sizes, same process, interleaved, fastest of five: load slows both alike                                         |
| Known superlinear work: the capacity check rule                                                                                                                                                                                            | ratio, under 64                                                                           | `checks`    | Held below quadratic until the refactor makes it linear; then it moves to 24                                         |
| Topology compiled and capacity analysed a fixed number of times per check run                                                                                                                                                              | count (spied calls)                                                                       | `checks`    | Counts                                                                                                               |
| One planning analysis for twenty selections; one explanation per node                                                                                                                                                                      | count                                                                                     | `planning`  | Counts                                                                                                               |
| Edges routed per drag frame, and how often a drag frame reads each node's box                                                                                                                                                              | count                                                                                     | `layout`    | Counts                                                                                                               |
| Same seed, same run                                                                                                                                                                                                                        | count                                                                                     | `sim`       | Counts                                                                                                               |
| Commits, canvas, inspector, card, node-wrapper and minimap renders per keystroke, per click and per pan frame, node wrappers per drag frame (pipeline, 100 and 500 nodes)                                                                  | count                                                                                     | `renders`   | Counts; budgets in `tests/bench/ui/renders.bench.ts` with room for a stray commit, never for an extra render per key |
| DOM nodes and listeners kept per open and close (second window)                                                                                                                                                                            | count                                                                                     | `memory`    | Counts after GC                                                                                                      |
| Entry, startup, canvas first view and live view gzip sizes                                                                                                                                                                                 | bytes                                                                                     | `bundle`    | Bytes                                                                                                                |

Not gated, and why:

- **Milliseconds.** A busy machine, a CI runner with coverage or a cold disk moves them by tens of percent; a retry
  hides them. They're compared normalised as a trend (`pnpm bench:compare` lists anything beyond its noise).
- **Drag render counts** (how many frames React batches depends on timing; the node wrappers' per frame are gated, since batching only lowers them), **frame rates**, **dots drawn**, **heap
  bytes** (V8's own caches grow with use): report-only, compared with tolerance.
- **Growth at sizes below 500 nodes**: allocation-heavy code fits the young generation there and runs several times
  faster per node, which reads as superlinear growth (`fromFlow` measured 25× from 250 to 2,000 nodes, 11× from 500 to
  4,000).

Gates hold today's state, hotspots included: a budget that is "about one render per node per keystroke" keeps it from
becoming two. When the refactor fixes a hotspot, tighten its gate in the same change.

## Output

- `tests/.output/bench/results.json`: schema `livediagrams-bench/v1`. `meta` (date, mode, commit, branch, machine,
  Node, Chromium, Playwright, Vite and React versions, CPU throttle, calibration in ms for Node and the browser, gate
  totals and failures), `info` (per suite: browser version, the HTML template, the bundle's chunks and modules) and
  `metrics`: `{ id, suite, scenario, kind: time|count|ratio|bytes|percent, unit, value, normalized?, stats?: { n, median, p90,
min, max, mean, cov }, workload?: { family, n, nodes, edges, fingerprint }, gate?: { op, limit, pass, why } }`.
- `tests/.output/bench/summary.md`: environment, gates, and every suite as a table (workloads in rows, sizes in columns).
- `tests/.output/bench/profiles/*.cpuprofile`.
- `pnpm bench:compare base.json head.json` prints (or writes with `--md`) the comparison: failed gates, timings slower
  beyond their noise (normalised; noise is 25% or three times the larger CoV of the two, whichever is more, and at
  least 2 ms; 50% for single-sample timings), counts that changed, growth ratios up by half, chunks that grew and the
  modules that grew in them, and what got faster. It exits 1 on a failed gate (and, with `--fail-on-regression`, on a
  slower timing).

## CI

`.github/workflows/bench.yml`:

- **Pull requests: Benchmark gates.** `pnpm bench:gates` (type-checks the benchmarks first), the gates table in the job
  summary, results as an artifact. About 3 minutes locally, more on a runner. Make it a required check once it has run
  clean for a week.
- **Nightly (02:41 UTC) and on demand: Benchmarks.** `pnpm bench` (or `quick`/`gates` from the dispatch form), then the
  comparison against the committed baseline and against the previous nightly in the run's summary, and the results,
  summary, comparisons and profiles as an artifact for 90 days. A failed gate or suite fails the run after the artifact
  is saved.

## Baseline

`tests/bench/baseline/master.json` (and its summary, `master.md`): `pnpm bench` on master `bf806a6` plus this suite,
2026-10-15. AMD Ryzen 9 7950X (16 cores, 32 threads), 68 GB, Windows 11, Node 24.22.0, Chromium 156 (Playwright
1.64.1), Vite 8.3.4, React 19.3.1, CPU throttle 2×. Calibration: Node 9.7 to 14.9 ms per suite (10.6 median), browser
26 ms. 2,997 metrics; all 72 gates pass. It ran in parts (`--keep`), each under the two-hour limit of the tool that ran
it: the Node suites 25 minutes, cold load 45, interactions and features 30, the rest 35 (the profiles once more, after a
fix to how they name anonymous functions).

The headline numbers (medians, ms unless marked; browser numbers at 2× CPU throttle on the main thread):

| What                                                       | 100            | 500               | 1,500                | 5,000            |
| ---------------------------------------------------------- | -------------- | ----------------- | -------------------- | ---------------- |
| Cold load, first node (pipeline)                           | 785            | 866               | 1,293                | 6,831            |
| Cold load, settled (pipeline / mesh)                       | 1,141 / 845    | 1,705 / 2,044     | 3,474 / 8,787        | 27,170 / 164,083 |
| Cold load, longest frame (mesh)                            | 403            | 1,433             | 8,289                | 154,422          |
| Cold load, Kubernetes import: settled                      | 1,872          | 7,503             | 76 s of main thread  | no node in 5 min |
| JS heap after load (pipeline)                              | 11.9 MB        | 32.1 MB           | 79.0 MB              | 247.5 MB         |
| Type a name: main-thread ms per key (pipeline / mesh)      | 28 / 52        | 137 / 264         | 440 / 1,664          | 1,540 / –        |
| Type a name: input to next paint, p50 (pipeline)           | 23             | 114               | 3,497 (keys queue)   | 13,523           |
| Type the secondary line / a number, ms per key (pipeline)  | 22 / 25        | 106 / 107         | 328 / 225            | 722 / 691        |
| Select a node: click to painted inspector (pipeline)       | 68             | 354               | 886                  | 2,446            |
| Pan: main-thread ms per frame (pipeline)                   | 10             | 53                | 142                  | 425              |
| Zoom: main-thread ms per wheel notch (pipeline)            | 51             | 339               | 778                  | 1,938            |
| Drag: main-thread ms per frame (pipeline / mesh)           | 41 / 101       | 213 / 603         | 475 / 3,945          | 2,927 / –        |
| Live view: main-thread ms per frame (pipeline, worker, x1) | 4.9            | 160               | 200                  | 186              |
| Live view: frames per second (pipeline, worker, x1)        | 60             | 5.9               | 4.9                  | 5.4              |
| Auto-layout through the UI (pipeline)                      | 182            | 932               | 3,887                | –                |
| PNG / SVG export (pipeline)                                | 4.2 s / 2.7 s  | 17.7 s / 12.9 s   | 51.2 s / 44.0 s      | –                |
| Interactive HTML export (pipeline)                         | 362            | 347               | 962                  | –                |
| Switch to German (pipeline)                                | 200            | 471               | 1,285                | –                |
| Run simulations through the UI (pipeline, two saved)       | 222            | 512               | 1,059                | –                |
| `runChecks` (Node; mesh / pipeline)                        | 3.5 / 2.5      | 21 / 11           | 95 / 71              | 381 / 238        |
| Run simulations (Node, pipeline)                           | 120            | 315               | 810                  | 4,278            |
| `analyzeCapacity` (Node; mesh / pipeline)                  | 1.3 / 1.1      | 8.9 / 5.5         | 41 / 22              | 186 / 80         |
| Full routing (Node; pipeline / mesh / k8s)                 | 12 / 163 / 199 | 101 / 824 / 3,410 | 476 / 5,177 / 38,904 | 3,666 / – / –    |
| Drag frame routing (Node; pipeline / mesh)                 | 6.1 / 86       | 30 / 328          | 110 / 1,451          | 820 / –          |
| Live frame, engine and controller only (Node, pipeline x1) | 0.18           | 0.57              | 1.8                  | 6.9              |
| Open a file: `parseNative` (Node, pipeline)                | 0.42           | 1.7               | 5.7                  | 19.3             |
| Kubernetes import (Node)                                   | 146            | 526               | 946                  | 4,561            |

Bundle (the shipped build, gzip): entry 105.5 kB (budget 123.5), startup JavaScript 154.2 kB in 20 files, the canvas's
first view 333.1 kB, live view's download 117.2 kB in 5 chunks, all JavaScript 2.48 MB in 146 chunks.

Render counts per unit (pipeline at 500 nodes): a keystroke in a name commits 4 times and renders 1,557 components (725
of them React Flow node wrappers); a click on another node commits 10 times and renders 4,375 (2,050 node wrappers); a
pan frame renders 4.4 (no node) and a drag frame 1,648. Live view renders 900 components per commit at 500 nodes (`NodeBadge` for
every node), 1,759 at 1,500. Leaks: nothing kept per open and close of the inspector, the command palette, the export
dialog or live view; a minute of live view at 1,500 nodes grows the DOM by 6,108 nodes and the heap by 5.6 MB.

Inspector planning: the inspector's work estimate (`src/planning/budget.ts`) turns planning off for the generated
diagrams from about 48 nodes, and for several public examples (the featured Kafka example among them), while the
computation it guards takes 3 to 9 ms at 100 to 250 nodes (`planning/planningCompute`). Not a cost, so not in the list
below, but a limit to revisit in the refactor. Checks don't run by themselves above 1,500 nodes (`BIG_DIAGRAM` in
`src/canvas/checks/useChecks.ts`), so `load/checksDone` stops at 500.

## Hotspots

Ranked by the main-thread time they cost in the scenarios people feel, at 1,500 nodes unless noted. Each is a code
target: what to change, where, and the evidence (metric ids are in `master.json`; the profiles are `profile/*`).

1. **Routing every edge when a diagram opens (and after auto-layout and tidy).** After the first nodes paint, the router
   blocks the main thread: an 8.3 s frame for the mesh at 1,500 nodes, 154 s at 5,000 (settled after 164 s), 235 s for
   the annotated pipeline at 5,000; the Kubernetes import shows no node within five minutes at 5,000 and spends 76 s of
   main thread at 1,500. In Node, `layout/routeAll` grows about n^1.5 for the pipeline (101 ms, 476 ms, 3.7 s; the gate
   reads 21–22× for 8× the nodes), and takes 5.2 s for the mesh and 39 s for the Kubernetes import at 1,500. Each
   edge's search works on an obstacle grid built from the whole diagram. _Where:_ `src/canvas/geometry/router.ts`
   (`Router.route`), `orthogonal.ts` (`search`, `linkCost`, `segmentHitsRect` top the load, typing and drag
   profiles), `obstacleGrid.ts`; reached through `selectRoutes` in `src/canvas/edges/useEdgeRoute.ts`. _Target:_ a
   spatial index, so an edge only sees the obstacles near its corridor; the visible edges first and the rest in idle
   slices; never a frame of seconds. Auto-layout through the UI takes 3.9 s at 1,500 nodes where the layout itself takes
   5 ms (`layout/autoLayout`): the rest is this.
2. **Re-routing during a drag.** Only 6 to 8 edges change per frame (`layout/routeDragFrame-edgesRouted`), yet a frame's
   routing takes 110 ms at 1,500 pipeline nodes and 820 ms at 5,000, 1.45 s for the mesh and 13.6 s for the Kubernetes
   import at 1,500: each re-routed edge still searches the whole diagram's grid. In the browser a drag frame costs 475 ms
   of main thread for the pipeline at 1,500, 3.9 s for the mesh and 6.1 s for the annotated pipeline (whose notes and
   shapes are obstacles too: 3.1 s a frame in Node at 1,500, 155 edges re-routed). _Same code as 1. Target:_ update the moved node's cells instead of the grid, and draw provisional routes
   while the pointer moves, routed properly on drop.
   _perf/1-editing:_ the searches were already local (the router keeps every route whose search area the move doesn't
   touch); what read the whole diagram was the nudging pass after them (every node tested for every moved segment and
   every bundle's room: three quarters of a mesh frame) and each search's preparation (every node padded and tested).
   Both use a spatial index now, with the same results (every route of six families, full and over 36 drag frames, in
   two styles, compared with master's). A frame's routing in Node, interleaved with master's: 105 → 29 ms for the
   pipeline and 1,296 → 232 ms for the mesh at 1,500; reads of each node's box per frame 11,453 → 152 (pipeline at
   2,000) and 42,234 → 874 (mesh at 500), gated. The annotated pipeline (155 edges searched again per frame) and the
   Kubernetes import (40) gain little: their frames are the searches themselves, which hotspot 1's work speeds up.
   In the browser (with hotspot 4's fix) a drag frame's main thread: 365 → 160 ms (pipeline at 500), 525 → 432 (1,500),
   597 → 550 (mesh at 500); the style, layout and paint of the whole canvas are most of what's left (hotspot 8).
3. **A keystroke in a node's name resizes its card and re-routes its edges.** A name costs 440 ms of main thread per key
   at 1,500 pipeline nodes against 328 for the secondary line and 225 for a number; in the mesh 1.66 s per key against
   379 (4.4×). At a quick typist's pace the keys queue: input to next paint has a median of 3.5 s (pipeline) and 18 s
   (mesh) at 1,500 nodes. The typing profile (`profile/typeName-mesh@500`) is routing and `getBoundingClientRect`.
   _Target:_ don't remeasure and re-route on every key (keep the card's width while its name is being typed, or
   debounce it; `tests/e2e/checks-ui.spec.ts` already notes the cost).
   _perf/1-editing:_ routing already skips a key that doesn't change the card's measured size (`selectRoutes`,
   `useEdgeRoute.test.ts`), and React Flow measures once a frame, so keys typed within a frame route once; counted in
   the browser, eight keys in a mesh service's name routed once. What a key cost was every node's wrapper rendering (4)
   and, when the card grew, the whole-diagram nudging (2). Main thread per key: 230 → 106 ms (pipeline at 500), 432 →
   313 (1,500), 288 → 248 (mesh at 500); input to next paint 1,554 → 76 ms at 500 pipeline nodes, 2,164 → 177 for the
   mesh. At 1,500 nodes keys still queue (2.5 s): the canvas's own render and React Flow's store updates remain.
4. **Every node's React Flow wrapper re-renders on every edit, click and frame.** Per keystroke 1.4 wrapper renders per
   node (2,044 at 1,500), per click 4 (6,134), per drag frame 1.4 (2,146), when only one card's data changed (a pan, by
   contrast, renders 4.4 components and no node). It's most of what the secondary line (328 ms per key) and a number
   (225 ms) cost at 1,500, and of selection (7). The card itself (`DiagramNodeImpl`, memoised) renders once: the node objects are recreated, so React
   Flow's wrapper re-renders for each. _Where:_ the flow nodes built in `src/canvas/CanvasView.tsx` and
   `src/editor/useEditor.ts` (`toFlow`, `withNodeAria` and `withRovingFocus` in `src/canvas/convert.ts` map every
   node to a new object). _Target:_ keep a node's object while it doesn't change. Gated (`renders/*/NodeWrapper`):
   lower the budgets when it's fixed.
   _perf/1-editing:_ the node objects were already kept (`withNodeAria` and `withRovingFocus` cache their copies per
   node). The canvas handed React Flow new functions on every render instead: the node hover handlers, which React Flow
   passes to every node's wrapper, the minimap's colour functions (every minimap rect re-rendered too), and the move
   handlers and snap grid, which it copies into its store. They keep their identity now. Per key at 1,500 pipeline
   nodes: 2,044 wrapper renders → 1.3, 4,188 renders in all → 89; per click 6,134 → 5 and 12,542 → 138; per drag frame
   2,299 → 1.6. Budgets are now a few renders whatever the size (wrappers and minimap rects per key, per click and per
   drag frame), and `tests/e2e/perf.spec.ts` counts them on the dev server.
5. **PNG and SVG export run on the main thread.** 4.2 s for a PNG at 100 nodes, 17.7 s at 500 and 51 s at 1,500, with a
   single frame of 30 s; SVG 44 s at 1,500. The Interactive HTML export of the same diagram takes 1 s. _Where:_
   `src/interop/image.ts` (html-to-image clones and inlines the whole canvas DOM). _Target:_ build the SVG from the model
   and the routes, as the HTML export builds its payload, and rasterise it in a worker with OffscreenCanvas.
6. **Live view re-renders every node's badge on every publish, and reads styles and path lengths every tick.** At 500
   nodes the main thread is 95 to 100% busy and draws 5 to 9 frames a second, worker renderer or not (160 ms per frame
   with the worker, 108 with the fallback); at 100 nodes the worker does help (4.9 ms against 14.5). Each publish (8 a
   second) renders 900 components at 500 nodes and 1,759 at 1,500 (`NodeBadge` for every node, `IdleChip`,
   `LiveIcon`). The live profile is `readMarch` (`getComputedStyle` for every marching path and its ancestors, each
   tick; 324 ms of a 4 s profile), `getPointAtLength` and `getTotalLength` (300 ms), and style and layout ("(program)",
   2.6 s). _Where:_ `src/live/NodeBadges.tsx`, `src/live/liveScene.ts` (`readMarch`), `src/live/pathSampler.ts`, the
   tick in `src/live/LiveSession.tsx`. _Target:_ badges that subscribe to their own node's numbers; read the march
   styles when they change, not every tick; sample paths from the router's points instead of the SVG.
7. **Selecting a node commits about ten times.** A click commits 9 to 10 times and renders 4,375 components at 500 nodes;
   click to painted inspector takes 886 ms at 1,500 pipeline nodes, 1.06 s for the mesh and 2.4 s at 5,000. The profile
   (`profile/select-pipeline@1500`) is reconciliation and store selectors (`shallow`, `updateProperties`) and
   `getBoundingClientRect`. _Target:_ one commit for the selection and the inspector's opening; with 4 fixed, most of
   the rest goes too.
   _perf/1-editing:_ 11.2 → 9.2 commits and 4,375 → 139 renders per click at 500 nodes; the canvas renders twice per
   click, not four times (the tooltip's hide and show around a click render its own layer), and the grow chip measures
   its node once. Click to painted inspector: 725 → 183 ms (pipeline at 500), 941 → 539 (1,500), 415 → 244 (mesh at
   500). The rest are separate input events (pointer down, focus, click), each committing on its own: one commit for
   all of them would delay what each shows.
8. **Layout reads on every store change while a diagram loads, and every node always in the DOM.** The load profile at
   1,500 nodes spends 1.8 s of its 5.7 s busy in `useCovered`'s `check` (it loops over every node with
   `getBoundingClientRect` on each store change) and `overlayRects` (forced layout). At 5,000 nodes the page keeps
   110,508 DOM nodes and 248 MB of heap after GC: every node and edge is rendered, in view or not. A pan frame renders
   4 components and still costs 142 ms of main thread at 1,500 nodes (425 at 5,000): style, layout and paint of the whole
   canvas. A zoom notch costs 778 ms (1.9 s at 5,000), five times a pan frame, so something more reacts to the scale
   (`useReadableScale` and the cards it styles are the first place to look). _Where:_
   `src/canvas/useOverlayFit.ts`; React Flow's `onlyRenderVisibleElements`. _Target:_ measure once per frame or on
   resize; render only what's in view above a few hundred nodes (minding the accessibility and test paths that expect
   every node).
9. **Live view grows the DOM and the heap while it plays.** A minute of playback at 1,500 nodes adds 6,108 DOM nodes and
   5.6 MB of heap after GC (`live/domNodesLiveGrowth60s`, `live/heapLiveGrowth60s`), and opening and closing live view
   leaks nothing (`memory/liveView`): something kept while it runs (the event log, trace labels, badges) never shrinks.
   _Target:_ a heap snapshot after a minute shows what holds the nodes; bound it.
10. **The engine and the live controller's per-frame work grows with the diagram.** In Node, without React or drawing, a
    live frame (`LiveController.advance` and a full `snapshot()`, as `LiveSession`'s tick asks every frame) takes
    1.8 ms at 1,500 nodes and 6.9 ms at 5,000 at the default rate (8 ms at x100): half a frame's budget before anything
    is drawn. `snapshot()` copies every node's state and the event log (3.7 ms at 5,000, `sim/engineSnapshot`), and an
    idle tick still walks every node (`sim/idleTick` grows linearly). _Where:_ `src/live/controller.ts` (`snapshot`
    every frame), `src/sim/engine.ts`. _Target:_ draw from `frame()`, publish only what changed, skip idle nodes.

Smaller, also measured: the capacity check rule is superlinear (its sizing fix analyses the diagram again per candidate;
the gate reads 18–25× for 8× the nodes) and `runChecks` takes 381 ms on the 5,000-node mesh in its worker; Run
simulations takes 4.3 s at 5,000 nodes in its worker; the Kubernetes and compose imports take 3 to 5 s at 5,000 nodes.

## Proving the gates

Each gate was checked against the regression it exists for, injected on purpose and reverted (`git checkout -- src`)
on the baseline's commit:

| Regression injected                                                                                                          | Gates run                   | Result                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O(n²) in a hot path: `compileTopology` finds each edge's target with `nodes.find` instead of its Map (`src/sim/topology.ts`) | `checks`, `sim`, `planning` | **Caught** by 4 gates: `runChecks-structural` 25.7× (mesh) and 33.6× (pipeline), `engineLoad` 36.7× (mesh) and 31.0× (pipeline), all against 24; before, 9 to 10×                                      |
| An extra render per keystroke: the inspector bumps a state in an effect on the name                                          | `renders`                   | **Caught**: `type-name/Inspector` 2.08 (100 nodes) and 2.25 (500) per key against 1.75; before, 1.17 to 1.25. The commit count didn't move: React folded the update into a commit it was making anyway |
| A bigger entry chunk: the YAML parser imported in `src/main.tsx`                                                             | `bundle`, `pnpm size`       | **Caught**: entry 135.0 kB gzip against 123.5 (`pnpm size` fails too), startup 183.7 kB against 177                                                                                                    |
| Routing without its spatial index (perf/1-editing's gates run on master's router)                                            | `layout`                    | **Caught**: `routeDragFrame-readsPerNode` 11,453 (pipeline at 2,000) against 400 and 42,234 (mesh at 500) against 2,000; with the index, 152 and 874                                                   |
| Every node's wrapper re-rendered (perf/1-editing's budgets on master: an inline node handler and minimap colours)            | `renders`                   | **Caught**: per key 725 wrappers and 725 minimap rects at 500 nodes against 3; per click 2,050 against 8, 11.2 commits against 10; per drag frame 768 against 4                                        |

The suite's own checks: three back-to-back `pnpm bench:gates` runs passed every gate every time (see
[Measured variance](#measured-variance)), and the render hook was checked against React's development profiler.

## Review

Two rounds of the repository's Codex review (`scripts/review/run.sh --since origin/master`, seven angles).

- **Round 1: 2 P1, 15 P2, all fixed.** The P1s (raised by five of the seven reviewers): the pan scenarios dragged with the
  left button, which draws a selection box in edit mode, and the zoom scenario used a plain wheel, which pans. Pan is now
  a middle-button drag, zoom is Control and the wheel, and both check that the viewport moved or scaled; the interaction
  and render baselines were measured again (a pan now renders 4 components and no node; zoom turned out to cost five
  times a pan frame). The P2s fixed: routing benchmarks use the canvas's own route input (notes and shapes as obstacles,
  shapes as edge ends); the workload cache key covers all of `src/` and the lockfile; `compare` takes its 2 ms floor in
  normalised units, counts renders per second as work (not throughput) and keeps heap bytes out of the bundle report;
  utilisation is a percentage, never normalised; cold loads skip the checks wait where checks don't run by themselves;
  `run.mjs` spawns Node without a shell and quotes pnpm's arguments on Windows.
- **Round 2: no P0 or P1; 9 P2.** Fixed: a suite rerun with `--keep` replaces its earlier parts; the import growth gate
  checks both imports succeeded; Terraform's Draw everything reads every resource; the render gates require the
  components they budget to have rendered; the cold-load checks observer no longer depends on init-script order; the
  live view budget covers its whole download. Not changed, with reasons:
  - _Extract the planning computation into `src/planning/compute.ts` and benchmark that._ It changes app code, which this
    branch doesn't; `planningCompute` mirrors `compute()` in `src/planning/cache.ts` call for call. Worth doing in the
    refactor, then point the benchmark at it.
  - _Record `firstNode` after a visible node paints._ React Flow mounts nodes hidden until measured, so `firstNode` can
    lead the first visible frame by the measuring pass. Fixing it changes what the committed baseline measured; it's
    noted here and is the first change for the next baseline (`settled` and `mainThread` already include the frame).

A gate also caught a real change while this branch was being finished: rebased onto master with #126 ("Fit the view on
settled signals"), `renders/select/commits` went from 10.2 to 11.2 commits per click and failed its budget of 11. Reverting
#126 locally brought it back to 10.2. The budget is now 12, raised on purpose with that reason in
`tests/bench/ui/renders.bench.ts`; the committed baseline predates #126, so the next nightly comparison will list it.

## Extending

- **A scenario.** Node: add an `s.timing(...)` to a suite in `tests/bench/node` (or a new `*.bench.ts`), timing with
  `measure` or `measureFresh` and recording with `s.time`. Browser: a test in `tests/bench/ui` using `Bench` (open a
  workload, `gesture`, `metrics`, `heap`, counts) and the suite's `time`/`count`. Use `data-testid` selectors only.
- **A gate.** Only for something that doesn't depend on the machine: `s.growth(...)` (two sizes an eighth apart, 500
  nodes or more), or `s.count(..., { limit, why })`. Prove it: inject the regression it's for, see it fail, revert, and
  note it in [Proving the gates](#proving-the-gates).
- **A budget.** Raise one only on purpose, in the change that needs it, and say why in the commit (as
  `scripts/bundle-budget.mjs` asks). Lower it when a refactor improves it.
- **A workload family.** A pure function `(n) => DiagramFile` in `src/bench/workloads`, registered in `index.ts`;
  `workloads.test.ts` checks it's valid, the right size and deterministic.
- **The baseline.** After a change that moves the numbers on purpose, run `pnpm bench` on master on a quiet machine and
  commit `tests/.output/bench/results.json` as `tests/bench/baseline/master.json` (and `summary.md` as `master.md`).
