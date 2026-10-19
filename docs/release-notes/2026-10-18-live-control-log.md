## Live: tweaks survive a scrub; the simulation runs identically in every browser (shared Live P1)

This is the first slice of the approved meeting host and shared Live design: the control log and the determinism
fixes. There's no collaboration UI yet; that comes in P2, Watch together.

- **A scrub back keeps your live tweaks.** Before, if you scrubbed back past a tweak and the nearest saved moment
  was older than it, the tweak was lost. A change of entry rate, which replays the run, lost it too. Tweaks here
  means Replicas, Slow down, Kill, Pause, an injection, a fault, or a traffic toggle. Now every change to a running
  simulation is logged on the 10 ms tick it lands on (`src/live/controlLog.ts`), and a scrub or a replay applies
  it again on that exact tick. A scrub back to before a tweak cuts the log there: the tweak is a branch no longer
  taken.
- **Tweaks stay run-only.** Nothing in the log writes the diagram. Only Save to diagram and Apply fix do, as before.
- **The same run, bit for bit, in Chromium, Firefox and WebKit.** Three calls could differ in the last bit between
  JS engines, and each is replaced so no golden moves:
  - the throughput smoothing constant (`Math.exp`) is now a literal;
  - the latency buckets (`Math.log`) now compare against the powers of 1.12, computed by IEEE multiplication and
    corrected by the few units in the last place that V8's `**` differs by;
  - the automatic dot scale (`Math.log10`) now finds its power of ten by multiplying.

  The latency fix is a real one. With the old code, 23 of the 77 example runs differed in WebKit.

- **For shared Live (P2):**
  - The controller exposes its tick, run id, log and an op listener.
  - A run digest (`src/sim/digest.ts`) is an FNV-1a hash over the clock, the generator's draw count and each
    node's counters.
  - `ENGINE_VERSION` (`src/sim/version.ts`) is a hash of `src/sim` and `src/model`.
  - A sim clock (`src/live/simClock.ts`) lets a follower track the driver's tick, up to 5% faster or slower and
    never past it.

## Verification

- **New unit tests in `src/live/controlLog.test.ts`:**
  - ops are stamped on their tick and come in order, and a restart starts a new run;
  - a scrub back past a tweak gives the digest of a run that never scrubbed (the nearest checkpoint predates the
    tweak);
  - injections, outages and recoveries replay on their ticks;
  - a scrub back before a tweak drops it;
  - an entry-rate replay keeps an earlier tweak;
  - tweaks never touch the diagram;
  - the digest doesn't depend on frame length.

  The replay tests fail with the replay switched off.

- **Determinism guard:** `src/sim/determinism.test.ts` fails a PR that adds a transcendental Math call or `**` to
  the simulator. It also checks the bounds equal V8's powers exactly, and that the new buckets equal the old for
  every latency up to 200 s (and in eighths of a ms up to 2.5 s), except at an exact bound.
- **Cross-engine check:** `pnpm test:engines` (`tests/engines`) plays every public example's saved simulations to
  60 s in Chromium, Firefox and WebKit, with a tweak, an injection, an outage and a scrub back. All 234 tests pass
  in about 30 s. It runs in Nightly's new "Engine determinism" job (failures open the Nightly issue): installing
  Firefox and WebKit costs more than the run, and the guard test covers every PR.
- **No golden changed:** `pnpm parity:node` reports 2426 goldens, 0 changed.
- **Live e2e:** the capacity, fault drills, live, slow motion, simulation truth and clarity, trace, simulation
  checks and live labels specs pass, 124 of 124.
- **Bundle:** the live session is 134,562 B gzip against a 135,000 B budget (master: 133,112 B). The startup and
  the canvas's first view are unchanged.
