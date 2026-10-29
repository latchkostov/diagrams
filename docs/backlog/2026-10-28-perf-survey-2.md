## Performance survey 2 — measurement scope

Measured application revision **b65664666f2669b8fecfd1c2fce9c48d058d81a0**, the master revision after #383,
on 2026-10-28. This change contains measurement helpers and this report only. No application behavior,
budget, generated artifact or output golden is intentionally changed.

Environment: Windows, Ryzen 9 7950X, 32 logical processors, 64 GiB RAM, Node 24.22.0, Chromium
156.0.8078.4 (pinned Playwright), one browser benchmark worker, 1440 × 900, device scale 1,
**2× main-thread CPU throttle**.
Loopback Vite preview; no network throttle. These are local baseline observations, not a controlled
before/after comparison or predictions of a particular device's latency. Future comparisons belong in
the **Compare browser benchmarks** Actions workflow with both revisions in one job.

The public small example is `kafka-order-pipeline` (15 nodes / 15 edges); `black-friday-commerce` has
60 nodes / 73 edges. Scale workloads are the repo's deterministic event pipeline at 500 nodes / 485 edges /
11 boundaries and 1,500 nodes / 1,457 edges / 32 boundaries.
Startup uses the shipped production build. Other UI measurements use the production E2E build; separate
diagnostic runs retain function names. Profiles are excluded from the headline timing samples.

Read alongside [the remaining pan/drag backlog](2026-10-28-pan-scale-residual.md) and
[the existing Linux stress baseline](2026-10-28-linux-stress-baseline.md). Historical 119 ms/step drag
and 481 ms/step Live pan readings are context, not same-run comparison baselines.

## Method and reproduction

`tests/bench/ui/survey2.bench.ts` reuses the repo's `Bench` harness, workload cache, Chrome counters,
frame observer and full-GC readings. It is opt-in (`SURVEY2=1`) and is skipped during normal benchmark
runs. `tests/bench/survey2.config.ts` owns and stops the three preview servers. Port ranges below avoid
the reserved ports.

```powershell
fnm exec --using 24 -- cmd /c pnpm install --frozen-lockfile
fnm exec --using 24 -- cmd /c pnpm sync
$env:BENCH_SIZES='500,1500'
fnm exec --using 24 -- cmd /c pnpm bench:prepare
fnm exec --using 24 -- node scripts/bench/build.mjs
fnm exec --using 24 -- cmd /c pnpm build
$env:SURVEY2='1'
$env:BENCH_CPU='2'
$env:BENCH_PORT='6250'
fnm exec --using 24 -- cmd /c pnpm exec playwright test -c tests/bench/survey2.config.ts
# Separate diagnostic run; omit the five-minute memory scenarios.
$env:SURVEY2_TRACE='1'
$env:SURVEY2_SAMPLES='1'
fnm exec --using 24 -- cmd /c pnpm exec playwright test -c tests/bench/survey2.config.ts --grep 'startup|edit|features|live pipeline|viewer'
fnm exec --using 24 -- node scripts/perf/survey2-summary.mjs
```

Raw samples, Chrome traces, CPU profiles, phase summaries and the synthetic exported viewer stay in
ignored `tests/.output/bench/survey2/`. The summary helper reports each metric's actual sample count,
median and range. Repeated invocations append raw observations; use a new `BENCH_OUT` directory for
an independent experiment, preparing its workloads/builds there first. Trace phase totals are nested
Chrome events, not additive exclusive percentages. CPU-profile inclusive stacks are likewise not additive.

The collected session keeps its earlier exploratory rows. Its final summary layers `corrected.jsonl`,
`cleaned.jsonl` and `final.jsonl` over `samples.jsonl`, replacing complete metric groups, not selecting
individual fast samples. Live's initial two probes failed because the helper tried Overview without
opening its menu. The viewer was then measured through the actual skill CLI, and the reopen probe used
distinct IDs. Tracing also exposed full-canvas ARIA failure snapshots from intermediate count/camera
assertions. Final paste/layout waits retain the same completion predicates with lightweight polls;
the earlier contaminated timing groups are excluded. Paste now has its own unchanged-Overview fixture,
rather than inheriting a preceding drag/connect sequence.

```powershell
fnm exec --using 24 -- node scripts/perf/survey2-summary.mjs tests/.output/bench/survey2 corrected.jsonl cleaned.jsonl final.jsonl
$env:BENCH_PAN_LIVE='0'
$env:BENCH_SIZES='1500'
fnm exec --using 24 -- cmd /c pnpm exec playwright test -c tests/bench/playwright.config.ts panScale.bench.ts --grep 'pan-scale fitted pipeline@1500'
$env:BENCH_SIZES='500,1500'
fnm exec --using 24 -- cmd /c pnpm exec vitest run -c tests/bench/vitest.config.ts tests/bench/node/layout.bench.ts -t 'layout and routing pipeline@(500|1500)'
```

Definitions:

- **First canvas:** the harness's first animation frame containing diagram nodes. A fresh context and
  disabled browser cache per sample; OS/server caches are not flushed. **Bytes** are resource encoded
  body sizes fetched before that frame, excluding the HTML document and HTTP headers. JS and all-resource
  totals are separate; resource arrival order can change what lands before the frame.
- **TTI:** the existing startup helper's operational proxy: canvas/last long-task end followed by two
  seconds without a long task. The reported endpoint excludes that observation window. It is not a
  standardized interactivity score. **Live entry:** click to controls/particle canvas and two frames,
  after startup readiness. No first-use module preloading is forced.
- **Drag/pan:** 20 real pointer moves, one animation frame per move, plus release and three finishing
  frames, using `Bench.gesture`. Main-thread task ms/step includes start/release work. Frame p90 is a
  separate measure; neither is an input-latency budget. Multi-drag moves two selected nodes.
- **Discrete actions:** action to asserted result plus two frames, with Chrome main-thread counters.
  These wall readings include Playwright actionability/protocol overhead; they are not isolated browser
  Event Timing durations. Undo/redo verify the position, connect verifies an additional edge, and paste verifies 50 added nodes.
  Auto-layout includes its one-second quiet-window observation; its task time excludes idle waiting.
  Run simulations waits for the real worker completion counter. Exports wait for completed downloads;
  PNG is first-use, SVG follows PNG, HTML follows SVG, on the newly auto-laid-out drawing.
- **Memory:** renderer main-thread JS heap after two full GCs; DOM/listener counts after GC. Worker,
  GPU, native DOM backing storage and total process RSS are outside this reading. Five minutes means
  real wall-clock playback, not a fast-forwarded clock. The leak probe switches five distinct 500-node
  diagrams through Open/New/Your diagrams in one SPA document, then repeats the reopen/close window.

## Measured results

Validation correction (2026-10-29): the original Run simulations timings below waited only for a
fulfilled worker promise, without verifying that both simulations played. The five-minute Live heap
readings retained the timing observer's growing history. Keep these as historical raw observations,
not validated complete-run timings or application-only heap retention. The corrected helper verifies
the UI's played count and skip notes and clears observer history before every heap reading; these
two metrics need fresh measurements before further performance conclusions.

All times are milliseconds unless shown otherwise. Values are medians; ranges are the observed sample
min–max, not confidence intervals. Every row gives its sample count.

### Cold startup

| Example / language | First canvas (range) |         TTI (range) | JS bytes before canvas | All resource bytes before canvas | Live entry (range) | Samples |
| ------------------ | -------------------: | ------------------: | ---------------------: | -------------------------------: | -----------------: | ------: |
| Small / en         |        562 (561–846) |       632 (630–930) |                363,979 |                          533,035 |      205 (200–240) |       3 |
| Small / de         |        593 (583–612) |       661 (659–686) |                406,983 |                          576,039 |      252 (203–256) |       3 |
| Black Friday / en  |        767 (707–792) | 1,828 (1,768–1,898) |                392,026 |                          621,101 |      671 (643–690) |       3 |
| Black Friday / de  |        740 (732–828) | 1,850 (1,841–2,091) |                431,559 |                          660,634 |      597 (482–603) |       3 |

Small/en JS ranges from 363,979–367,450 B and total resources from 531,183–536,506 B;
small/de JS ranges from 406,983–421,922 B and resources from 576,039–590,978 B.
The Black Friday byte counts are identical across their three samples. Lazy detail chunks landing
before the first frame explain the small-example byte variance. German adds its core catalog and
language loader, rather than every language or the full German catalog.

### Editing and feature actions

| Metric / method                                           |  @500 value (range) |    @1500 value (range) | Samples per size |
| --------------------------------------------------------- | ------------------: | ---------------------: | ---------------: |
| Node drag, main-thread task per move, initial Focus       | 51.10 (47.80–51.59) | 133.47 (130.34–137.78) |     3 × 20 moves |
| Two-node drag, main-thread task per move                  | 52.29 (48.13–55.45) | 157.99 (152.28–162.56) |     3 × 20 moves |
| Undo single drag, action to result/paint                  |       868 (821–903) |    2,430 (2,349–2,465) |                3 |
| Redo single drag, action to result/paint                  |       352 (333–368) |          698 (692–715) |                3 |
| Undo two-node drag                                        |       221 (202–255) |          615 (606–631) |                3 |
| Redo two-node drag                                        |       320 (315–323) |          581 (565–581) |                3 |
| Connect two previously unconnected nodes, 8 pointer moves | 1,280 (1,265–1,308) |    2,737 (2,731–2,805) |                3 |
| Paste 50 nodes from unchanged Overview, including reveal  | 4,263 (3,678–4,298) |    7,297 (6,532–9,898) |                3 |
| Auto-layout, including 1 s quiet observation              | 3,579 (3,498–3,615) |    7,317 (7,114–7,353) |                3 |
| Run simulations, both saved pipeline runs, UI end to end  |       540 (539–574) |        987 (844–1,171) |                3 |
| Pure layered-layout calculation, Node, per call           | 1.043 (0.898–1.205) |    2.977 (2.913–3.660) |  15 / 11 batches |

The existing `panScale.bench.ts` fitted Edit control at 1,500 measures **142.24 ms/step** node drag
(139.34–147.20; frame p90 66.7 ms) and **78.46 ms/step** pan (77.69–78.94), three 20-move gestures each.
Its recorder is `tests/.output/bench/parts/browser-panScale-62704.json`. The pure calculation's recorder
is `node-layout-63600.json`; those are unthrottled, GC-separated batched per-call observations, not a
browser speedup ratio. A roughly 3 ms graph calculation does not explain seconds of browser preparation,
even allowing for the different environments.

### Live, export, viewer and memory

| Metric / method                                           |          Value (range) | Samples |
| --------------------------------------------------------- | ---------------------: | ------: |
| PNG @1500, File action to completed download              | 45,468 (44,338–50,026) |       3 |
| SVG @1500, dialog action to completed download, after PNG | 39,038 (38,844–39,453) |       3 |
| HTML @1500, dialog action to completed download           |      1,019 (945–1,094) |       3 |
| PNG @1500, longest animation frame                        |    2,896 (2,852–3,256) |       3 |
| SVG @1500, longest animation frame                        |    2,384 (2,362–2,459) |       3 |

The scale Live setup starts from the default Focus, enters Live, explicitly chooses Overview, warms
60 frames and pans with no selected node or opened Properties dock. This differs from the historical
pan-scale scenario, which goes Live after dragging a selected node with its Inspector open. Do not call
the difference from the historical 481 ms/step a regression. The fitted Edit control below uses the
original repo benchmark.

| Metric / method                                              |     @500 value (range) |    @1500 value (range) | Samples per size |
| ------------------------------------------------------------ | ---------------------: | ---------------------: | ---------------: |
| Live entry from default Focus, controls/canvas to two frames |    2,022 (1,656–2,032) |    6,302 (5,107–6,428) |                3 |
| Idle Live, main-thread task per nominal frame                | 135.43 (132.78–156.89) | 261.69 (250.48–279.34) |    3 × 20 frames |
| Running Live pan, main-thread task per move                  | 337.88 (311.15–338.58) | 693.47 (683.33–720.89) |     3 × 20 moves |
| Paused Live pan, main-thread task per move                   |    41.42 (39.34–42.84) | 201.60 (200.47–208.32) |     3 × 20 moves |
| Pause, action to state/paint                                 |    1,547 (1,506–1,663) |    3,327 (3,061–3,358) |                3 |
| Play, action to state/paint                                  |          172 (151–347) |    1,729 (1,682–1,813) |                3 |
| Seek forward with 75.1% slider input                         |          629 (584–632) |    2,114 (1,969–2,133) |                3 |
| Seek backward with 25.1% slider input                        |          565 (514–609) |    1,369 (1,333–1,388) |                3 |

The seek clocks reach 14,330 ms (@500) / 13,490 ms (@1500) forward and 5,020 ms backward in every
sample. The run track includes its estimated drain; fractions are not percentages of just the 10 s
traffic window. Idle and pan have different wall durations and callback counts: their difference is
not a measured subtraction of background work. Running-pan readings include ongoing simulation and
publication work. Paused pan retains the Live DOM.

| Skill-generated HTML viewer @500                       |                        Value (range) |          Samples |
| ------------------------------------------------------ | -----------------------------------: | ---------------: |
| First node frame from file navigation                  |                      854 (781–1,047) | 3 fresh contexts |
| Playback controls ready and two frames from navigation |                  2,846 (2,768–3,219) | 3 fresh contexts |
| Self-contained file size                               |                          2,068,808 B | 1 generated file |
| Renderer JS heap after controls, full GC               | 40,309,360 B (40,195,976–41,216,168) |                3 |

Exported using `skills/livediagrams/scripts/export-html.mjs` from the same 500-node workload, preserving
its coordinates and opening the result from `file://`. No network load is involved.

| Live @1500, elapsed wall time |                  Heap after GC |  DOM nodes |  Listeners | Samples |
| ----------------------------- | -----------------------------: | ---------: | ---------: | ------: |
| Warmed starting point         |                     135.30 MiB |     44,267 |     12,752 |       1 |
| 62.565 s                      |                     136.12 MiB |     44,271 |     12,752 |       1 |
| 125.297 s                     |                     139.92 MiB |     44,271 |     12,752 |       1 |
| 187.933 s                     |                     139.27 MiB |     44,271 |     12,752 |       1 |
| 240.445 s                     |                     137.34 MiB |     44,271 |     12,752 |       1 |
| **302.726 s**                 | **140.50 MiB (147,325,032 B)** | **44,271** | **12,752** |   **1** |

This is one real five-minute run with six readings, not six independent runs. Heap ends 5.20 MiB above
the warmed start and fluctuates; listeners are constant and DOM is constant after the initial four-node
increase. It does not establish an unbounded leak or prove that every heap owner is bounded.

| Five distinct 500-node diagrams, one SPA session | Heap after GC (B) | DOM nodes | Listeners | Readings |
| ------------------------------------------------ | ----------------: | --------: | --------: | -------: |
| After opening/importing five, fifth still open   |        37,867,652 |    12,489 |     5,113 |        1 |
| After closing to New                             |        12,953,236 |     1,548 |       616 |        1 |
| First reopen window, fifth open                  |        39,539,304 |    12,498 |     5,254 |        1 |
| First window, closed                             |        13,991,520 |     1,539 |       614 |        1 |
| Second window, fifth open                        |        39,713,244 |    12,498 |     5,254 |        1 |
| Second window, closed                            |        14,170,612 |     1,539 |       614 |        1 |
| Third window, fifth open                         |        39,917,200 |    12,498 |     5,254 |        1 |
| Third window, closed                             |        14,325,136 |     1,539 |       614 |        1 |

The seeded harness diagram precedes the five distinct-ID imports. Each window reopens and closes all
five through Your diagrams; timing-observer buffers are cleared before each GC reading. The last two
closed windows retain **zero additional DOM nodes/listeners**, but heap rises **154,524 B per five cycles**
(30,905 B/cycle). That small positive heap trend is unclassified retention, not a demonstrated product
leak: no retaining-path comparison was made and the automation remains installed. Do not report
“zero leaks.” It ranks below the multi-second interaction costs; a longer heap-owner probe is a
separate follow-up if this small trend persists with minimal instrumentation.

## Ranked next five

Scores are planning judgments: impact (1–10, frequency and severity) × confidence in the proposed win
(0–1) ÷ implementation risk (1–5). They are not statistical confidence levels. Estimates below are
unimplemented hypotheses to validate in a same-job comparison, not improvements achieved by this PR.

| Rank | Opportunity                                                | Impact | Confidence | Risk | Score |
| ---- | ---------------------------------------------------------- | -----: | ---------: | ---: | ----: |
| 1    | Live publication, badge semantics and viewport subscribers |     10 |       0.90 |    3 |  3.00 |
| 2    | Geometry/readiness work after bulk edits and layout        |      8 |       0.85 |    3 |  2.27 |
| 3    | Single-selection affordance geometry on Undo/release       |      7 |       0.90 |    3 |  2.10 |
| 4    | Drag hit testing and connection feedback                   |      8 |       0.80 |    4 |  1.60 |
| 5    | Fuse PNG style capture with its existing style sharing     |      6 |       0.70 |    4 |  1.05 |

### 1. Stop repeating scene-wide Live work at the publication clock

**Evidence:** full-pane Live pan is 693 ms/step, versus 202 paused. In the separate 20-move running
trace, `querySelectorAll` consumes 1,106 ms self time, badge-viewport update 1,132 ms inclusive,
Decorator `apply` 1,202 ms inclusive, and React root work 2,370 ms inclusive. Chrome records 3,212 ms
style recalculation, 1,751 ms layout, 996 ms paint and 1,139 ms layer work. The diagnostic renderer is
**worker, zero drawn particles** at Overview: moving more particle work to a worker cannot remove this.

**Proposed fix:** maintain a badge/decoration element index from structural mutations; update entering
and leaving viewport members by delta; distinguish a new semantic publication from unrelated DOM
notifications. Cache the displayed semantic fields per badge, and isolate graph-derived subscribers
from transform-only store updates through supported React Flow APIs. Preserve every off-screen name
and readout. The current same-membership shortcut is already present; simply adding it again is not a fix.

**Estimated win:** 100–200 ms/step (14–29%) in this running-pan scene, with benefits to ongoing Live
controls. This does not imply reaching 30 ms/step: paused-pan tracing alone contains 1,688 ms layer work
and 619 ms paint over 20 moves. Cold Live entry's 6.30 s also contains a separate initial style/layout
and canvas-transfer cost; the steady-state estimate does not claim to remove it.

**Risk/guards:** stale accessibility or first-frame readouts. Add counts for indexed membership and
unchanged semantic writes; retain `badgeViewport.test.ts`, `badgeReadout.test.tsx`, `decorations.test.ts`,
and `live-large`, `live-budget`, `workbench-overview`, `zoom-identity` and `pan-pointer` E2E coverage.
Run the Live benchmark gates for transitions/edge flips, output parity and the common gates below.

### 2. Coalesce geometry preparation after bulk changes

**Evidence:** auto-layout takes 7.32 s including its quiet observation, with 6.31 s main-thread work.
Its clean trace samples 1,217 ms in `getBoundingClientRect`, 1,266 ms in `clientWidth`, and 2,402 ms
Chrome style recalculation. React's synchronous commit and `measuredRun` dominate the stacks. The
clean paste trace contains 3,079 ms `FrameDetail.update` and 1,280 ms native `getAnimations`; the latter
is the app's `useMeasuredTask` scanning the scene before filtering for overlay animations. Both clean
profiles have zero ARIA-diagnostic frames. The pure Node layout median is 2.98 ms at 1,500.

**Proposed fix:** scope animation discovery to the actual overlays that can hold a fit, cache it between
relevant mutations/completions, and share one geometry revision across a bulk transaction's readiness,
frame decoration and identity passes. Reuse unchanged measured boxes and route/label inputs. Existing
per-pass read/write batching is already present; the opportunity is repeated cross-pass discovery and
invalidations. Keep delayed entrance animations, reveal, final edge geometry and camera completion
coupled to the real readiness boundary; never publish idle before the final captions and labels.

**Estimated win:** initially target 1–2 s of the 7.32 s layout action (14–27%), with a similar shared-work
opportunity in the 7.30 s paste. Replacing the 3 ms layout calculation cannot recover seconds.

**Risk/guards:** first-frame and completion races, overlaps and stale routes. Add geometry-read/pass
counts per bulk transaction and animation discovery. Retain `settledTask.test.ts`, `fontReadiness.test.ts`, `FrameDetail.test.tsx`, camera geometry/controller tests,
`editor/layout.test.ts`, clipboard/history tests, and `layout`, `drawing-basics`, `undo-selection`,
`viewport`, `annotations` and inspector E2E specs. Output parity must stay unchanged.

### 3. Index the single-selection affordance's nearby obstacles

**Evidence:** Undo after one node's drag costs 2.43 s, versus 615 ms after a two-node drag. In the
single-Undo profile, GrowChip's `place` accounts for 1,249 ms inclusive and rectangle reads for 1,251 ms
self; Chrome records 1,205 ms style recalculation. `GrowChip.tsx` walks every node and edge label and
reads their rectangles when the single-selection “+” remounts. The first drag profile also includes
651 ms `FrameDetail.update`, so all release cost must not be attributed to the chip.

**Proposed fix:** query a conservative spatial index of current node/label geometry, then read exact
DOM bounds only for nearby candidates. Invalidate for font, size, routing and camera-scale changes;
fall back when the index cannot establish clear space. Preserve the current side ordering and
placement result. This is different from the previously rejected chip-wrapper shortcut or generic
session-metadata cache.

**Estimated win:** 0.8–1.2 s on single-selection Undo (33–49%), and a smaller release-tail improvement.
A 10% improvement in mean drag cost is not yet established; do not claim one from the Undo estimate.

**Risk/guards:** a “+” covering a label or using stale transformed bounds. Add counted candidate/rectangle
reads and a reference-result comparison, including zoomed labels and annotations. Keep
`nodes/chipPlacement.test.ts`, `growEdges.test.ts`, `historySelection.test.ts`, and `drawing-basics`,
`undo-selection` and `zoom-identity` E2E checks. Reopen/close memory checks guard index ownership.

### 4. Reduce pointer hit testing and repeated connect feedback

**Evidence:** two-node drag costs 158 ms/step. Its 20-move trace contains 1,509 ms Chrome `HitTest`
(75 ms/step), while routing's sampled inclusive time is about 320 ms. Connect takes 2.74 s for eight
moves; its profile samples 782 ms in `elementFromPoint`, with React Flow's `isValidHandle` on the stack,
and Chrome records 1,085 ms style recalculation plus 508 ms hit testing. Connection feedback also
removes/re-adds target classes and uses whole-subtree cursor/handle selectors.

**Proposed fix:** investigate stable-body pointer capture for node drags using the existing pan capture
pattern, while retaining world-space drop/membership feedback. React Flow remains the connection's
capture owner. Reuse already resolved connection targets where supported, avoid same-target mark
churn, and narrow redundant scene-wide feedback invalidation. Do not replace the gesture controller
or assume the pure route search is the entire bottleneck.

**Estimated win:** target 20–40 ms/step on two-node dragging (13–25%), and 0.2–0.5 s per connect
(7–18%). Capture and connection-feedback changes can be validated and shipped independently.

**Risk/guards:** lost capture, wrong ports, cancellation, auto-pan and boundary drops. Add counts for
same-target resolution/mark writes and capture lifetime. Retain interaction controller and
`connectTarget.test.ts` units, plus `pan-pointer`, `connection-cancellation`, `drawing-basics`,
`annotations`, `platform` and viewport E2E coverage. Keep the one-cursor and exact target assertions.

### 5. Avoid PNG's write-then-read-back of complete style blocks

**Evidence:** PNG remains 45.47 s despite sliced rasterization. In its separate profile,
`cloneCSSStyle` accounts for 17,478 ms inclusive and the later `shareRasterStyles` pass for 6,163 ms;
native `setProperty` takes 9,466 ms self time. The sharing pass reads the computed declarations back
from a clone that just had those declarations individually written. SVG separately spends 20,289 ms
in style copying and 5,323 ms in sliced serialization; its downloadable bytes have a stricter contract.

**Proposed fix:** for PNG only, capture ordered style records once and feed the existing sharing
representation directly, avoiding repeated native style writes and the second complete read-back.
Preserve the font/image embedding lifecycle and the existing font-size, iframe and path adjustments;
resource-bearing styles must remain available until embedding finishes. Keep SVG on its current path.

**Estimated win:** 6–10 s on cold PNG (13–22%), against roughly 15 s of potentially avoidable native
write/read-back work in the trace. This does not promise a similar SVG win or removal of the
remaining natural-frame preparation/raster tail.

**Risk/guards:** style cascade, missing fonts/images, cancellation and peer edits. Add native-write
counts and retain `interop/imageClone.test.ts`, `image.test.ts`, and `image-slices`, `image-resources`,
`collab-export` and `html-export` E2E coverage. SVG stays byte-identical; PNG stays within the existing
16/255, 0.1%/600-pixel capped contract. No tolerance, golden or bundle-budget increase belongs to this fix.

### Common acceptance gates for those implementations

Each future fix needs a regression that fails with the fix removed. Prefer operation/DOM-read counts;
for scaling use an eighth-size baseline and the existing 24× mixed-linear limit, not elapsed-ms budgets.
Run targeted specs with `pnpm gate quick ... --max-wait 1 --workers N`, output parity, fixed size/reserve
checks and a UX review. Timing/rendering changes also require the affected specs and the annotation,
drawing, round4-polish, viewport, platform and inspector neighbours under Linux load, five repeats,
with declared workers/CPUs. Run the required full gate once after the final commit; do not replace
failure evidence with retries or golden updates.

## What needs no new work

- Small/public-example startup: first canvas is 0.56–0.77 s at the medians here. The small German example
  is 31 ms behind English in this run; the language split does not reintroduce every locale into startup.
  The Black Friday trace is mostly idle during the readiness observation; no broad locale/entry rewrite
  is justified by these local readings. Keep the current lazy boundaries and budgets.
- Headless Run simulations: both saved runs finish through the UI in 0.54 s / 0.99 s. The worker's CPU
  is not throttled by the main-thread setting. Seek remains visible work: its profile includes 671 ms
  in the actual seek stack, but also substantial browser/UI work; that does not justify another broad
  engine rewrite ahead of the ranked DOM work.
- Interactive HTML export is about 1.02 s at 1,500 nodes. The skill's 500-node file shows nodes in
  0.85 s and playback controls in 2.85 s, offline, from a 2.07 MB file. No viewer rewrite is selected.
- The five-minute run has constant listeners and, after its initial change, constant DOM counts.
  Reopen cleanup is reported above; do not describe the small retained-heap trend as proof
  of zero leaks.

Deferred rather than “fine”: cold SVG still takes 39 s. The [earlier default-style/shallow-template
prototypes](2026-10-27-image-export-byte-identical-raster-blocker.md) did not establish a win and some changed declaration ordering. Do not repeat them without
new evidence or apply PNG's internal style-sharing representation to the downloadable SVG. Whole-viewport
compositing and per-part promotion previously regressed; DOM culling would violate the complete-DOM,
off-screen accessibility and first-frame contracts. None is adopted by this survey.

## Verification and limitations

Pre-commit verification: production build and size pass; all **3,178 parity goldens are unchanged**
(0 changed/added/missing/stale, 110 browser cases passed). `pnpm test --maxWorkers=4` passes 695 files:
**14,343 passed, 10 expected failures, 13 skipped**, zero unexpected failures. The two selected existing
Node benchmark cases pass; fifteen unrelated cases were deliberately filtered out. Size preserves every
limit; largest core locale is 37,872/38,000 gzip B and the platform viewer 623.8/805.0 gzip kB.
`pnpm i18n check` exits zero with existing missing/stale-translation warnings and zero errors.

The final measured scenarios and diagnostic runs pass. The first extended helper run had two failures
from its unopened Live View menu; their corrected scenarios pass. Timing groups contaminated by assertion
diagnostics were remeasured, not adjusted arithmetically. No application fix, assertion relaxation,
golden re-recording or heavy base/head benchmark comparison was performed. The final static checks and
post-commit full-gate outcome, including its exact SUMMARY when one is emitted, accompany the PR.

Evidence logs are `tests/.output/survey2-{startup,scale,corrected,cleaned,final-metrics,trace,final-traces,node-layout,unit,parity,size,i18n}.log`.
All benchmark servers were owned by Playwright and stopped after their run. This Windows/Chromium survey
does not replace the Linux load verification required for a future timing/rendering implementation.
