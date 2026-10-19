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

### Review round 1

- **Checkpoints record the replay position.** Each checkpoint now records how far the replay had got, not the
  newest op logged. Before, a checkpoint taken while a rebuild was catching up claimed ops it hadn't reached yet, so
  a later scrub back skipped them. Seek and the rebuild share one cursor, the last op applied, and every checkpoint
  saves it, the rebuilt start included. A live tweak made during a rebuild lets the rebuild finish first.
- **A newer edit wins over an older tweak.** Say you tweak a property live, then set the same property in Inputs &
  capacity or edit it in the diagram. A later rebuild now keeps your newer choice instead of reviving the tweak.
  Tweaks of other properties still replay.
- **The log owns its ops.** It keeps a frozen copy of each op, so changing an object after passing it changes
  neither the engine nor history. It keeps only the latest Inputs snapshot, so a slider drag doesn't grow it.
- **The digest covers fault overlays,** and moves out of the live view's chunk. The controller exposes detached
  `digestInputs()` (a snapshot and the generator's draw count, never the engine itself), and shared Live loads
  `snapshotDigest` with its own code.

### Review round 2

- **A tweak during a rebuild no longer blocks.** Round 1 made a tweak wait for a rebuild to finish, and it finished
  it synchronously, inside the click (one probe blocked for 16 s). Now a tweak, injection, fault or note resume that
  arrives while a rebuild is catching up waits in a queue, in order. The rebuild keeps its bounded slices (20 of
  about 6 ms per frame) and can still be cancelled. When it reaches its tick, the waiting ops apply and are logged
  on that tick. Play and pause still change at once, and are logged on the tick the rebuild is heading for. A
  restart, another simulation, a seek or closing the view drops the queue.
- **`ENGINE_VERSION` and the determinism guard** now cover `src/stencils` too: roles, device throughput and family
  defaults decide what a tick does.

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
- **Review round 1 tests:**
  - "scrubbing after a rate rebuild preserves later logged tweaks", covering a tweak and an outage;
  - "fault overlays survive checkpoint seeks and rate rebuilds", with a slowdown changed once, a boundary down and
    a failure rate;
  - a newer Inputs edit winning over an older tweak after a rebuild;
  - the log owning its ops;
  - one Inputs snapshot.

  Each of the first three fails with its fix reverted.

- **Review round 2 tests:**
  - "keeps replay bounded when a tweak arrives mid-rebuild": a tweak, an injection, a fault and a pause during a
    rate rebuild. No replay work runs synchronously for them, each later timer step moves at most 200 ticks, and
    afterwards everything is logged on 40 s and the digest equals the uninterrupted run's;
  - a restart cancels the waiting tweaks;
  - a fault-only difference changes the digest, and lifting it restores the digest.

- **Bundle:** the live session is under its 135,000 B gzip budget (master: 133,112 B; review round 1
  added 174 B, round 2 another 77 B: 134,813 B). The startup and the canvas's first view are unchanged.
