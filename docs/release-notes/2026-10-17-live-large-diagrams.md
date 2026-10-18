## Live view stays usable on large diagrams at high traffic (2026-10-17)

- **No fades on large diagrams.** Above 1,000 nodes and edges on the canvas, live view changes an edge between busy and
  idle, a dimmed node, a heat glow and the badges' pills at once instead of fading them, and over-capacity rings hold
  still instead of pulsing. At Traffic × 10 hundreds of fades ran at once; on 5,000 nodes 1,500 to 1,600 of them, now
  under ten. Smaller diagrams look exactly as before. No setting: it adapts by itself.
- **Busy edges stay lit between messages.** An edge stays marked active for three publishes (about 0.4 s) after its
  last message instead of flickering idle and back: at 1,500 nodes and × 10, about a third as many edges change state
  per publish. Presentation only: checks, counters and expectations are unchanged.
- **Slow frames slow the simulation less.** A frame now advances the simulation by up to a second (it was 100 ms), as
  far as the engine can afford, so message rates and backlogs move at the speed they show even when the page draws a
  frame a second. A tab coming back from the background resumes where it was, without a jump. Slow motion and the
  marching edges keep their pace; runs stay deterministic.
- **Benchmarks.** `tests/bench/ui/live.bench.ts` sets × 10 without opening the panel (so × 1 and × 10 measure the same
  scene), keeps a separate `x10heat` case that closes the panel as a person does and records how long that took, and
  measures the transient after × 10 on its own (`slowPhaseMs`, its frame rate, the steady frame rate, running
  transitions and composited layers). New count gates: running transitions per 100 elements on large diagrams, and edge
  churn per publish (`live gates pipeline@1500`, in `pnpm bench:gates`). `--grep` runs one browser benchmark by title.
  Details, commands and the before/after numbers: [benchmarks](../BENCHMARKS.md#live-view-on-large-diagrams).
- Before → after on 5,000 nodes at Traffic × 10, master and this branch on the same machine at the benchmarks' default
  2× CPU throttle: running fades 1,550 to 1,630 → under 10; the Inputs & capacity close click 43 s → 29 s (−32%); the
  steady frame rate unchanged (about 1 fps: the per-node work that remains is backlog hotspot 6). On 1,500 nodes:
  steady frame rate +33% (3.75 → 5.0 fps), edges changing state per publish −70%. On 500 nodes (below the
  threshold, fades kept): +50% (20 → 30 fps), from the edge hold and the frame clock. Not yet measured at
  a 4× throttle (the CI-like case of the nightly failure).
- Parity goldens: unchanged. `pnpm regen` refreshed the skill's viewer template (it carries live view's styles).
