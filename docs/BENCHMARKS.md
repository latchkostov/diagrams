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
| `examples`  | The public examples saved as `diagrams/v1` (`src/examples/*.json`), copied onto a grid until the size is reached (a v2 example's planning model, with its shared quota ids, belongs to one document). The inspector planning scenario reads every public example as saved.                                                                                                                                                                                                                                                                                                                  | yes        |

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
`tests/.output/bench/workloads/<key>/<family>-<n>.json`, keyed by a hash of everything that shapes it (the generators,
the importers, the model, the public examples). The browser suites read those files; `pnpm bench:prepare` writes them
before running a browser spec by hand.

## Metrics

Every metric has a stable id, `suite/scenario[/detail][/family@n]`. Times are milliseconds; the summary shows medians
with p90 beside them.

### Node suites (Vitest)

| Suite      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parse`    | `serialize` (save), `parseNative` (open: parse, migrate, validate), `toFlow` and `fromFlow` (the canvas's conversion both ways), file size                                                                                                                                                                                                                                                                                                                                         |
| `checks`   | `runChecks` (what the canvas runs in a worker after edits), `runSimulations` (Run simulations: every saved simulation played, with the losses it found)                                                                                                                                                                                                                                                                                                                            |
| `planning` | `analyzeCapacity` (behind the inspector's planning, the heat map and the capacity check) per family and size; `inspectorPlanning-keystroke` (the inspector's planning for one node recomputed as a keystroke in its label does) for legacy, P1, P2 and P3 files where the inspector offers it; `planningCompute` (the same past the inspector's work estimate, at 100 and 250 nodes); `explainEveryNode` (hover cards); `upgradePlanning` (to P3); `planningSignature`; `analyzeCapacity-withLoop` |
| `sim`      | `engineLoad`; `liveFrame` (the live view's per-frame main-thread work: `LiveController.advance` and `snapshot` each frame, `publish` every 125 ms) at three message rates (x1 free play; x10 and x100 Traffic × at the same dot scale); `engineStep`, `engineFrame`, `engineSnapshot`; `savedSimulation` (a saved simulation played to the end)                                                                                                                                    |
| `layout`   | `autoLayout` (layered layout), `tidyAll`, `tidySelection` (one boundary, the rest as obstacles), `routeAll` (every edge routed from scratch), `routeDragFrame` (one node moved a few pixels with the router kept) and the edges it routed per frame. Routing isn't timed for the mesh and the Kubernetes import at 5,000 nodes (`routeSkipped`): a single call takes minutes there (one Kubernetes sample ran past 15), and the curve to 1,500 already shows it                                                                                                                                                                                                                                |
| `imports`  | Compose, Kubernetes, Terraform and AsyncAPI: `import` (what File ▸ Import draws by default), `importEverything` (Draw everything), `read` (the reader alone), source size                                                                                                                                                                                                                                                                                                          |
| `exports`  | `interactiveHtml` (with the build's real viewer template and icons), `drawio`, `mermaid`, `shareEncode`/`shareDecode` (share links), `thumbnail` (the library's, on every save)                                                                                                                                                                                                                                                                                                    |

### Browser suites (Playwright, production e2e build)

| Suite      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load`     | Cold load in a fresh context: `firstNode` (navigation to the first frame with a node: first meaningful render), `settled` (the end of the last long animation frame, once three quiet seconds pass), `checksDone` (the first check run delivered; checks run by themselves up to 1,500 nodes), `firstNodeTimedOut` (nothing on screen in five minutes), main-thread task time and its script, style and layout parts, the longest frame and total blocking time, JS heap after GC, DOM nodes and listeners                                                              |
| `interact` | `pan` and `zoom` (main-thread ms per step, frame intervals, longest frame, input to next paint); `select` (a click to the frame the inspector shows the node; `select-first` unfolds the inspector); typing a node's name, its secondary line and a number in the inspector at a key every 120 ms (input to next paint per key, Event Timing's longest event per key, main-thread ms per key, check runs and planning analyses caused); `drag`. The pipeline and the mesh at every size they open in (the mesh stops at 1,500: at 5,000 it takes minutes to open and seconds a drag frame), the annotated pipeline at 1,500 |
| `renders`  | React commits and component renders per key, per click, per pan and drag frame, by component, and per second of live view                                                                                                                                                                                                                                                                                                                      |
| `live`     | Main-thread busy %, ms per frame, frame rate, particle frame rate and dots, with the particles drawn in the worker and on the main thread (`renderer=main`), at x1 and x10, turned on from a settled canvas (live view's frames never go quiet); heap and DOM over a minute of playback                                                                                                                                                                                                                                     |
| `features` | Auto-layout, Tidy up, Run simulations, PNG, SVG and Interactive HTML export, switching the language: input to done, main-thread time, longest frame                                                                                                                                                                                                                                                                                            |
| `memory`   | DOM nodes, listeners and heap kept per open and close of the inspector, the command palette, the export dialog and live view                                                                                                                                                                                                                                                                                                                   |
| `profile`  | CPU profiles (DevTools sampling profiler) of the slowest interactions, self time by function: the evidence behind [Hotspots](#hotspots)                                                                                                                                                                                                                                                                                                        |

### Bundle

The shipped build (`pnpm build`'s, no test hooks), chunk by chunk: the entry, the startup JavaScript (the entry and
what `index.html` preloads), the canvas's first view (startup plus `CanvasView` and `canvas-shared`), the live session,
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

| Concern              | What the suite does                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JIT and caches       | Warm-up calls before sampling (one for a call over 2 s); browser runs open a fresh context each run, so a cold load is cold                                                                                                                                                                                                                         |
| Timer resolution     | Node: a sample batches calls until it lasts 25 ms and divides; browser: input-to-paint and DevTools counters, not `Date.now()`                                                                                                                                                                                                                      |
| Garbage collection   | Node runs with `--expose-gc` and collects before every sample; browser heap readings collect twice first                                                                                                                                                                                                                                            |
| Outliers             | Several samples (Node 15, or 11 and 7 for the big sizes, fewer for calls over 5 s), medians, p90, CoV recorded                                                                                                                                                                                                                                      |
| Interference         | One process (Vitest `fileParallelism: false`, one fork) and one Playwright worker; Chromium's background throttling off                                                                                                                                                                                                                             |
| Pinned environment   | 1440 × 900, device scale factor 1, light theme, en-US, UTC, CPU throttle 2× on the main thread (`BENCH_CPU`)                                                                                                                                                                                                                                        |
| Determinism          | Seeded workloads with fingerprints; seeded simulations (`sim/determinism-checksum-delta` gates it); the engine and the live controller advanced with explicit time steps in Node (a fake clock that can't distort anything); Run simulations given a clock that never runs out (`now: () => 0`), so how much it plays doesn't depend on the machine |
| Machines and runners | A same-run calibration ("cu"): a fixed JavaScript workload (sorting, Maps, strings, JSON) timed in the same Node process at each suite's start and end, and in a page at the same throttle; every time is also stored divided by its own suite's reading, the one closest in time (a shared machine's speed moved by half between suites of one run)                                                                                                                                          |

Fake clocks stop where they would distort: the browser suites run on real time, because frames, input latency and the
live view's frame rate are what they measure (a page clock would also stop `requestAnimationFrame`).

**Why 2× and not 4×.** The repository's older perf scripts throttle 4×. At 4× the 5,000-node workloads take most of an
hour each to open and interact with; at 2× the whole suite runs overnight on a CI runner, and a few-ms keystroke is still
measurable. The calibration absorbs the difference between machines; the throttle sets how far below a fast desktop the
numbers sit.

### Measured variance

VARIANCE_SECTION

## Gates and report-only

A gate fails `pnpm bench:gates` (and the nightly run). Everything else is a trend.

| Gate                                                                                                                                                                     | Kind                                                                                      | Where              | Why it's robust                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Complexity of parsing, the canvas conversion, the checks, capacity analysis, the engine (load, frame, snapshot, idle tick), auto-layout, every importer and every export | ratio, `growth()` at 500 vs 4,000 nodes (an eighth), under 24 (linear is 8, quadratic 64) | Node suites        | Two sizes, same process, interleaved, fastest of five: load slows both alike                                         |
| Known superlinear work: the capacity check rule, full routing and a drag frame's routing                                                                                 | ratio, under 64 or 192                                                                    | `checks`, `layout` | Held below quadratic or cubic until the refactor makes them linear; then they move to 24                             |
| Topology compiled and capacity analysed a fixed number of times per check run                                                                                            | count (spied calls)                                                                       | `checks`           | Counts                                                                                                               |
| One planning analysis for twenty selections; one explanation per node                                                                                                    | count                                                                                     | `planning`         | Counts                                                                                                               |
| Edges routed per drag frame                                                                                                                                              | count                                                                                     | `layout`           | Counts                                                                                                               |
| Same seed, same run                                                                                                                                                      | count                                                                                     | `sim`              | Counts                                                                                                               |
| Commits, inspector, card and node-wrapper renders per keystroke, per click and per pan frame (pipeline, 100 and 500 nodes)                                               | count                                                                                     | `renders`          | Counts; budgets in `tests/bench/ui/renders.bench.ts` with room for a stray commit, never for an extra render per key |
| DOM nodes and listeners kept per open and close (second window)                                                                                                          | count                                                                                     | `memory`           | Counts after GC                                                                                                      |
| Entry, startup, canvas first view and live session gzip sizes                                                                                                            | bytes                                                                                     | `bundle`           | Bytes                                                                                                                |

Not gated, and why:

- **Milliseconds.** A busy machine, a CI runner with coverage or a cold disk moves them by tens of percent; a retry
  hides them. They're compared normalised as a trend (`pnpm bench:compare` lists anything beyond its noise).
- **Drag render counts** (how many frames React batches depends on timing), **frame rates**, **dots drawn**, **heap
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
  `metrics`: `{ id, suite, scenario, kind: time|count|ratio|bytes, unit, value, normalized?, stats?: { n, median, p90,
min, max, mean, cov }, workload?: { family, n, nodes, edges, fingerprint }, gate?: { op, limit, pass, why } }`.
- `tests/.output/bench/summary.md`: environment, gates, and every suite as a table (workloads in rows, sizes in columns).
- `tests/.output/bench/profiles/*.cpuprofile`.
- `pnpm bench:compare base.json head.json` prints (or writes with `--md`) the comparison: failed gates, timings slower
  beyond their noise (normalised; noise is 15% or three times the larger CoV of the two, whichever is more, and at
  least 2 ms; 25% for single-sample timings), counts that changed, growth ratios up by half, chunks that grew and the
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
26 ms. 3,012 metrics; all 70 gates pass. It ran in four parts (`--keep`), each under the two-hour limit of the tool that
ran it: the Node suites 25 minutes, cold load 45, interactions and features 30, the rest 35.

The headline numbers (medians, ms unless marked; browser numbers at 2× CPU throttle on the main thread):

| What                                                       | 100           | 500            | 1,500                | 5,000               |
| ---------------------------------------------------------- | ------------- | -------------- | -------------------- | ------------------- |
| Cold load, first node (pipeline)                           | 785           | 866            | 1,293                | 6,831               |
| Cold load, settled (pipeline / mesh)                       | 1,141 / 845   | 1,705 / 2,044  | 3,474 / 8,787        | 27,170 / 164,083    |
| Cold load, longest frame (mesh)                            | 403           | 1,433          | 8,289                | 154,422             |
| Cold load, Kubernetes import: settled                      | 1,872         | 7,503          | 76 s of main thread  | no node in 5 min    |
| JS heap after load (pipeline)                              | 11.9 MB       | 32.1 MB        | 79.0 MB              | 247.5 MB            |
| Type a name: main-thread ms per key (pipeline / mesh)      | 25 / 70       | 102 / 344      | 361 / 2,310          | 1,476 / –           |
| Type a name: input to next paint, p50 (pipeline)           | 22            | 76             | 2,590 (keys queue)   | 12,634              |
| Type the secondary line / a number, ms per key (pipeline)  | 23 / 27       | 79 / 68        | 273 / 252            | 1,218 / 1,098       |
| Select a node: click to painted inspector (pipeline)       | 80            | 218            | 807                  | 3,029               |
| Pan: main-thread ms per frame (pipeline)                   | 19            | 104            | 281                  | 710                 |
| Drag: main-thread ms per frame (pipeline / mesh)           | 47 / 130      | 174 / 664      | 620 / 4,341          | 2,541 / –           |
| Live view: main-thread ms per frame (pipeline, worker, x1) | 4.9           | 160            | 200                  | 186                 |
| Live view: frames per second (pipeline, worker, x1)        | 60            | 5.9            | 4.9                  | 5.4                 |
| Auto-layout through the UI (pipeline)                      | 182           | 932            | 3,887                | –                   |
| PNG / SVG export (pipeline)                                | 4.2 s / 2.7 s | 17.7 s / 12.9 s | 51.2 s / 44.0 s     | –                   |
| Interactive HTML export (pipeline)                         | 362           | 347            | 962                  | –                   |
| Switch to German (pipeline)                                | 200           | 471            | 1,285                | –                   |
| Run simulations through the UI (pipeline, two saved)       | 222           | 512            | 1,059                | –                   |
| `runChecks` (Node; mesh / pipeline)                        | 3.5 / 2.5     | 21 / 11        | 95 / 71              | 381 / 238           |
| Run simulations (Node, pipeline)                           | 120           | 315            | 810                  | 4,278               |
| `analyzeCapacity` (Node; mesh / pipeline)                  | 1.3 / 1.1     | 8.9 / 5.5      | 41 / 22              | 186 / 80            |
| Full routing (Node; pipeline / mesh / k8s)                 | 9 / 45 / 197  | 90 / 347 / 2,633 | 390 / 2,469 / 33,284 | 3,649 / – / –     |
| Drag frame routing (Node; pipeline / mesh)                 | 4.7 / 37      | 22 / 203       | 93 / 972             | 867 / –             |
| Live frame, engine and controller only (Node, pipeline x1) | 0.18          | 0.57           | 1.8                  | 6.9                 |
| Open a file: `parseNative` (Node, pipeline)                | 0.42          | 1.7            | 5.7                  | 19.3                |
| Kubernetes import (Node)                                   | 146           | 526            | 946                  | 4,561               |

Bundle (the shipped build, gzip): entry 105.5 kB (budget 123.5), startup JavaScript 154.2 kB in 20 files, the canvas's
first view 333.1 kB, the live session 79.7 kB, all JavaScript 2.48 MB in 146 chunks.

Render counts per unit (pipeline at 500 nodes): a keystroke in a name commits 3.7 times and renders 1,374 components (640
of them React Flow node wrappers); a click on another node commits 9 times and renders 4,375 (2,050 node wrappers); a
pan frame renders 654 and a drag frame 2,084. Live view renders 900 components per commit at 500 nodes (`NodeBadge` for
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
   main thread at 1,500. In Node, `layout/routeAll` grows about n^1.5 for the pipeline (90 ms, 390 ms, 3.6 s; the gate
   reads 21–22× for 8× the nodes), and takes 2.5 s for the mesh and 33 s for the Kubernetes import at 1,500. Each
   edge's search works on an obstacle grid built from the whole diagram. *Where:* `src/canvas/geometry/router.ts`
   (`Router.route`), `orthogonal.ts` (`search`, `linkCost`, `segmentHitsRect` top the load, typing and drag
   profiles), `obstacleGrid.ts`; reached through `selectRoutes` in `src/canvas/edges/useEdgeRoute.ts`. *Target:* a
   spatial index, so an edge only sees the obstacles near its corridor; the visible edges first and the rest in idle
   slices; never a frame of seconds. Auto-layout through the UI takes 3.9 s at 1,500 nodes where the layout itself takes
   4 ms (`layout/autoLayout`): the rest is this.
2. **Re-routing during a drag.** Only 6 to 8 edges change per frame (`layout/routeDragFrame-edgesRouted`), yet a frame's
   routing takes 93 ms at 1,500 pipeline nodes and 867 ms at 5,000, 972 ms for the mesh and 8.2 s for the Kubernetes
   import at 1,500: each re-routed edge still searches the whole diagram's grid. In the browser a drag frame costs 620 ms
   of main thread (frame p90 333 ms) for the pipeline at 1,500, 4.3 s for the mesh and 8.4 s for the annotated
   pipeline. *Same code as 1. Target:* update the moved node's cells instead of the grid, and draw provisional routes
   while the pointer moves, routed properly on drop.
3. **A keystroke in a node's name resizes its card and re-routes its edges.** A name costs 361 ms of main thread per key
   at 1,500 pipeline nodes against 273 for the secondary line and 252 for a number; in the mesh 2.31 s per key against
   327 (7×). At a quick typist's pace the keys queue: input to next paint has a median of 2.6 s (pipeline) and 20 s
   (mesh) at 1,500 nodes. The typing profile (`profile/typeName-mesh@500`) is routing and `getBoundingClientRect`.
   *Target:* don't remeasure and re-route on every key (keep the card's width while its name is being typed, or
   debounce it; `tests/e2e/checks-ui.spec.ts` already notes the cost).
4. **Every node's React Flow wrapper re-renders on every edit, click and frame.** Per keystroke 1.5 wrapper renders per
   node (2,299 at 1,500), per click 4 (6,134), per drag frame 1.7 (2,606), per pan frame 0.4 (613), when only one card's
   data changed. It's most of what the secondary line (273 ms per key) and a number (252 ms) cost at 1,500, and of
   selection (7). The card itself (`DiagramNodeImpl`, memoised) renders once: the node objects are recreated, so React
   Flow's wrapper re-renders for each. *Where:* the flow nodes built in `src/canvas/CanvasView.tsx` and
   `src/editor/useEditor.ts` (`toFlow`, `withNodeAria` and `withRovingFocus` in `src/canvas/convert.ts` map every
   node to a new object). *Target:* keep a node's object while it doesn't change. Gated (`renders/*/NodeWrapper`):
   lower the budgets when it's fixed.
5. **PNG and SVG export run on the main thread.** 4.2 s for a PNG at 100 nodes, 17.7 s at 500 and 51 s at 1,500, with a
   single frame of 30 s; SVG 44 s at 1,500. The Interactive HTML export of the same diagram takes 1 s. *Where:*
   `src/interop/image.ts` (html-to-image clones and inlines the whole canvas DOM). *Target:* build the SVG from the model
   and the routes, as the HTML export builds its payload, and rasterise it in a worker with OffscreenCanvas.
6. **Live view re-renders every node's badge on every publish, and reads styles and path lengths every tick.** At 500
   nodes the main thread is 95 to 100% busy and draws 5 to 9 frames a second, worker renderer or not (160 ms per frame
   with the worker, 108 with the fallback); at 100 nodes the worker does help (4.9 ms against 14.5). Each publish (8 a
   second) renders 900 components at 500 nodes and 1,759 at 1,500 (`NodeBadge` for every node, `IdleChip`,
   `LiveIcon`). The live profile is `readMarch` (`getComputedStyle` for every marching path and its ancestors, each
   tick; 405 ms of a 4 s profile), `getPointAtLength` and `getTotalLength` (264 ms), and style and layout ("(program)",
   2.2 s). *Where:* `src/live/NodeBadges.tsx`, `src/live/liveScene.ts` (`readMarch`), `src/live/pathSampler.ts`, the
   tick in `src/live/LiveSession.tsx`. *Target:* badges that subscribe to their own node's numbers; read the march
   styles when they change, not every tick; sample paths from the router's points instead of the SVG.
7. **Selecting a node commits about ten times.** A click commits 9 to 10 times and renders 4,375 components at 500 nodes;
   click to painted inspector takes 807 ms at 1,500 pipeline nodes, 1.46 s for the mesh and 3.0 s at 5,000. The profile
   (`profile/select-pipeline@1500`) is reconciliation and store selectors (`shallow`, `updateProperties`) and
   `getBoundingClientRect`. *Target:* one commit for the selection and the inspector's opening; with 4 fixed, most of
   the rest goes too.
8. **Layout reads on every store change while a diagram loads, and every node always in the DOM.** The load profile at
   1,500 nodes spends 1.1 s of its 4.1 s busy in `useCovered`'s `check` (it loops over every node with
   `getBoundingClientRect` on each store change) and `overlayRects` (forced layout). At 5,000 nodes the page keeps
   110,508 DOM nodes and 248 MB of heap after GC: every node and edge is rendered, in view or not. *Where:*
   `src/canvas/useOverlayFit.ts`; React Flow's `onlyRenderVisibleElements`. *Target:* measure once per frame or on
   resize; render only what's in view above a few hundred nodes (minding the accessibility and test paths that expect
   every node).
9. **Live view grows the DOM and the heap while it plays.** A minute of playback at 1,500 nodes adds 6,108 DOM nodes and
   5.6 MB of heap after GC (`live/domNodesLiveGrowth60s`, `live/heapLiveGrowth60s`), and opening and closing live view
   leaks nothing (`memory/liveView`): something kept while it runs (the event log, trace labels, badges) never shrinks.
   *Target:* a heap snapshot after a minute shows what holds the nodes; bound it.
10. **The engine and the live controller's per-frame work grows with the diagram.** In Node, without React or drawing, a
    live frame (`LiveController.advance` and a full `snapshot()`, as `LiveSession`'s tick asks every frame) takes
    1.8 ms at 1,500 nodes and 6.9 ms at 5,000 at the default rate (8 ms at x100): half a frame's budget before anything
    is drawn. `snapshot()` copies every node's state and the event log (3.7 ms at 5,000, `sim/engineSnapshot`), and an
    idle tick still walks every node (`sim/idleTick` grows linearly). *Where:* `src/live/controller.ts` (`snapshot`
    every frame), `src/sim/engine.ts`. *Target:* draw from `frame()`, publish only what changed, skip idle nodes.

Smaller, also measured: the capacity check rule is superlinear (its sizing fix analyses the diagram again per candidate;
the gate reads 18–25× for 8× the nodes) and `runChecks` takes 381 ms on the 5,000-node mesh in its worker; Run
simulations takes 4.3 s at 5,000 nodes in its worker; the Kubernetes and compose imports take 3 to 5 s at 5,000 nodes.

## Proving the gates

Each gate was checked against the regression it exists for, injected on purpose and reverted (`git checkout -- src`)
on the baseline's commit:

| Regression injected | Gates run | Result |
| --- | --- | --- |
| O(n²) in a hot path: `compileTopology` finds each edge's target with `nodes.find` instead of its Map (`src/sim/topology.ts`) | `checks`, `sim`, `planning` | **Caught** by 4 gates: `runChecks-structural` 25.7× (mesh) and 33.6× (pipeline), `engineLoad` 36.7× (mesh) and 31.0× (pipeline), all against 24; before, 9 to 10× |
| An extra render per keystroke: the inspector bumps a state in an effect on the name | `renders` | **Caught**: `type-name/Inspector` 2.08 (100 nodes) and 2.25 (500) per key against 1.75; before, 1.17 to 1.25. The commit count didn't move: React folded the update into a commit it was making anyway |
| A bigger entry chunk: the YAML parser imported in `src/main.tsx` | `bundle`, `pnpm size` | **Caught**: entry 135.0 kB gzip against 123.5 (`pnpm size` fails too), startup 183.7 kB against 177 |

The suite's own checks: three back-to-back `pnpm bench:gates` runs passed every gate every time (see
[Measured variance](#measured-variance)), and the render hook was checked against React's development profiler.

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
