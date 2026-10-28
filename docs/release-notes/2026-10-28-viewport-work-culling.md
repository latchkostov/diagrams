## Skip off-screen decoration work on large diagrams

Natural-card identity fitting and frame-decoration measurements now use a canvas-local spatial
query with a 256 screen-pixel margin on diagrams above 128 parts. All parts stay mounted and
accessible. Selected, focused, dragged, connected and camera-owned parts remain eligible, and
cards entering during a pan receive their current identity in that pan's frame.

Live state writes, Focus/Follow clipping, boundary titles and low-zoom chip fitting retain their
complete inputs. Capture still resets the entire drawing to its natural geometry. No parity
golden is changed or re-recorded: full parity compared 3,178 goldens with 0 changed, added,
missing or stale. The generated skill viewer is refreshed from source.

## Measurement method

The existing `interact` pan/zoom benchmarks are the fitted-view control. The new
`tests/bench/ui/viewport.bench.ts` uses the same gesture and Chrome task-time counters with most
parts off screen, three samples at both 500 and 1,500 pipeline nodes, 1440 × 900, CPU throttle 2,
and a names-preserving production E2E build. It records pan, zoom frame p90, steady Live task
milliseconds per frame across 180 frames, the off-screen card share and separate CPU profiles.
Timing results are observations, not test budgets. Raw results and profiles are local ignored
artifacts under `tests/.output/cull-before`, `tests/.output/cull-after` (first candidate) and
`tests/.output/cull-final` (with the title-membership cache).
`BENCH_VIEWPORT_ONLY=1` runs the existing interaction benchmark's pan/zoom phases and skips
its later selection, typing and dragging phases; the recorder marks this selection in metadata.

## Results

Three-sample medians, milliseconds, for the off-screen workload:

| Metric          | 500 before | 500 after | Change | 1,500 before | 1,500 after | Change |
| --------------- | ---------: | --------: | -----: | -----------: | ----------: | -----: |
| Pan task/step   |      25.79 |     25.58 |  −0.8% |        78.13 |       76.82 |  −1.7% |
| Pan frame p90   |       16.7 |      16.7 |     0% |         66.7 |        66.6 |  −0.1% |
| Zoom task/step  |     412.27 |    327.06 | −20.7% |     1,267.15 |      943.68 | −25.5% |
| Zoom frame p90  |      183.4 |     166.6 |  −9.2% |          550 |       483.4 | −12.1% |
| Live task/frame |     29.263 |    27.361 |  −6.5% |      172.203 |     172.617 |  +0.2% |

Zoom task samples do not overlap: 410.99–415.37 → 314.16–330.38 ms at 500,
1,247.58–1,269.35 → 929.53–948.66 ms at 1,500. Live at 1,500 remains within its original
spread (171.89–177.80 → 170.48–173.45 ms/frame). The measurable win is zoom; pan and Live
frame time are effectively unchanged. The first candidate added about 3.4 ms/pan step at 500
by rebuilding the title membership lookup. Caching membership until elements are replaced
removed that regression; a separate deliberate regression test catches rebuilding it on a pan.

The existing fitted-view controls, also three samples on the ordinary production E2E build:

| Metric                        | 500 before | 500 after | 1,500 before | 1,500 after |
| ----------------------------- | ---------: | --------: | -----------: | ----------: |
| `interact/pan-taskMsPerStep`  |      31.71 |     32.11 |       153.22 |      152.85 |
| `interact/pan-frameP90`       |       16.7 |      16.7 |           50 |          50 |
| `interact/zoom-taskMsPerStep` |     239.23 |    213.50 |       679.20 |      618.80 |
| `interact/zoom-frameP90`      |      166.6 |     166.6 |          500 |         500 |

Fitted-view zoom task time falls 10.8% / 8.9%; its frame p90 remains unchanged. The original
multi-rate Live transition suite was stopped after the interaction baseline; the focused Live
measurement above covers steady playback and includes three samples per size.

Before the change, 95.2% / 98.4% of cards were outside the pane at 500 / 1,500 nodes, yet the
identity and natural-card geometry loops visited every card. This is the off-screen share of
per-card work, not a claim that the same fraction of total browser CPU is removable. Sample-zero
CPU profiles attributed 27% of non-idle zoom samples to the FrameDetail chunk at both sizes.
During Live, that chunk accounted for 21% at 500 nodes but under 1% at 1,500; the Live decorator
accounted for about 4% / 10%. Browser style/layout and simulation/renderer work remain substantial.

## Choices

Kept DOM and all Live state updates: this preserves the existing accessibility/navigation tree
and current-state-on-entry behavior without a parallel accessible list or a catch-up protocol.
Kept complete chip inputs: neighbour budgets and merged paths must remain consistent with the
existing low-zoom behavior. Focus/Follow keep their full pin and clipping geometry. No Live
runtime code or bundle reserve was added, and no budget or assertion was relaxed.
