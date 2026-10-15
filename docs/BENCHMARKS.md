# Performance benchmarks

A benchmark suite for Live Diagrams: deterministic workloads from 100 to 5,000 nodes, the scenarios people feel
(opening, panning, typing, dragging, live view, checks, planning, imports, exports), a trustworthy baseline, gates that
catch regressions in CI without flaking, and a ranked list of hotspots for the refactoring round.

```sh
pnpm bench            # everything: about BASELINE_DURATION on a fast desktop; writes tests/.output/bench/{results.json,summary.md}
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
regression it catches.

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
| `examples`  | The public examples (`src/examples/*.json`), copied onto a grid until the size is reached.                                                                                                                                                                                                                                                                                                                  | yes        |

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
| `layout`   | `autoLayout` (layered layout), `tidyAll`, `tidySelection` (one boundary, the rest as obstacles), `routeAll` (every edge routed from scratch), `routeDragFrame` (one node moved a few pixels with the router kept) and the edges it routed per frame                                                                                                                                                                                                                                |
| `imports`  | Compose, Kubernetes, Terraform and AsyncAPI: `import` (what File ▸ Import draws by default), `importEverything` (Draw everything), `read` (the reader alone), source size                                                                                                                                                                                                                                                                                                          |
| `exports`  | `interactiveHtml` (with the build's real viewer template and icons), `drawio`, `mermaid`, `shareEncode`/`shareDecode` (share links), `thumbnail` (the library's, on every save)                                                                                                                                                                                                                                                                                                    |

### Browser suites (Playwright, production e2e build)

| Suite      | Scenarios                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load`     | Cold load in a fresh context: `firstNode` (navigation to the first frame with a node: first meaningful render), `settled` (the last long animation frame before a quiet second), `checksDone` (the first check run delivered), main-thread task time and its script, style and layout parts, the longest frame and total blocking time, JS heap after GC, DOM nodes and listeners                                                              |
| `interact` | `pan` and `zoom` (main-thread ms per step, frame intervals, longest frame, input to next paint); `select` (a click to the frame the inspector shows the node; `select-first` unfolds the inspector); typing a node's name, its secondary line and a number in the inspector at a key every 120 ms (input to next paint per key, Event Timing's longest event per key, main-thread ms per key, check runs and planning analyses caused); `drag` |
| `renders`  | React commits and component renders per key, per click, per pan and drag frame, by component, and per second of live view                                                                                                                                                                                                                                                                                                                      |
| `live`     | Main-thread busy %, ms per frame, frame rate, particle frame rate and dots, with the particles drawn in the worker and on the main thread (`renderer=main`), at x1 and x10; heap over a minute of playback                                                                                                                                                                                                                                     |
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
| Machines and runners | A same-run calibration ("cu"): a fixed JavaScript workload (sorting, Maps, strings, JSON) timed in the same Node process, and in the browser at the same throttle; every time is also stored divided by it                                                                                                                                          |

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
  summary, results as an artifact. About GATES_CI_DURATION on a GitHub runner. Make it a required check once it has run
  clean for a week.
- **Nightly (02:41 UTC) and on demand: Benchmarks.** `pnpm bench` (or `quick`/`gates` from the dispatch form), then the
  comparison against the committed baseline and against the previous nightly in the run's summary, and the results,
  summary, comparisons and profiles as an artifact for 90 days. A failed gate or suite fails the run after the artifact
  is saved.

## Baseline

BASELINE_SECTION

## Hotspots

HOTSPOTS_SECTION

## Proving the gates

INJECTIONS_SECTION

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
