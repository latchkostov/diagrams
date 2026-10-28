## Cap Live checkpoint memory

Saved Live runs retain checkpoints within a **48 MiB estimated-byte cap**, including engine,
runner and health history. Snapshot count no longer disguises growing queued work. Shared
configuration and copy-on-write history are charged in full by a conservative graph-size
counter, even when several tokens share their storage. The counter runs during the copy,
including Map/Set contents, array slots and UTF-16 strings, without serializing the graph.
The running engine and transient capture/restore allocations are outside this retention cap.
48 MiB leaves headroom for those allocations while retaining useful history on ordinary
browser heaps; increasing the old count limit would not provide that guarantee.

When space runs out, recent checkpoints stay dense and older gaps grow with their age.
Seeking restores the nearest retained earlier checkpoint and replays forward. The origin
and newest checkpoint are preferred, but neither can exceed the byte cap; an oversized
snapshot is discarded and earlier seeks can rebuild from the deterministic origin.

Checkpoint cloning preserves prototypes, cycles and aliases in one pass. It shares
replace-only resolved configuration while copying topology,
compiled routing, call policies, queues and accounting together with their
cross-slice aliases. Existing lineage and latency copy-on-write behavior remains intact.
There are no new controls, settings or UI strings. **No parity golden changes are intended.**
The internal scalar clock uses a named tuple to keep the Live bundle within its existing
reserve; startup and canvas still exclude checkpoint retention code. No budget was raised.
Queue helpers join the existing shared helper chunk to avoid separate import and gzip overhead.

Regression coverage includes byte-pressure eviction, logarithmic spacing, oversized
snapshots, shared configuration identity and random seeks compared byte for byte with
straight playback, including RNG, particles, counters and scripted edits. Restoring the
old count-only policy, bypassing restore and disabling configuration sharing each makes
the corresponding regression fail; all mutations were removed afterward.

## Measurement evidence

Node 24.22.0, generated public pipeline at 500 nodes, Traffic ×10, scale 5, seed 7:
the report's five-minute retained heap was **357.8 MiB**. A fresh baseline using the new
seek probe measured **359.5 MiB**, versus **78.0 MiB** with this change (about 78% less).
Both probe arms advance the same 300 simulated seconds at 60 Hz, publish every eight
frames and collect GC twice; this probe runs without wall-time pacing. Absolute heap
includes Vitest and its module graph, and is not a browser heap budget.

The probe samples 24 reproducible random whole-second targets from the same five-minute
ring, restoring the end state between samples. These are report-only timings, not test budgets.

| Seek latency | Baseline | Capped ring |
| ------------ | -------: | ----------: |
| p50          |  3.170 s |     2.847 s |
| p90          |  7.685 s |     6.046 s |
| p95          |  8.257 s |     6.633 s |
| maximum      |  8.264 s |     6.863 s |

The final state and all 24 seek snapshot SHA-256 values match. The retained positions
are 0, 175, 285 and 300 seconds; the one-minute shift in the logarithmic age score avoids
spending the cap on several near-identical late states. Run the opt-in probe with
`ENGINE_DIAG=seek` in `tests/bench/node/engineDiagnosis.bench.ts` to reproduce the method.

`sim/savedSimulation` at 500 nodes reports five-sample medians of 200.9 ms (steady) and
224.1 ms (incident). The 10,000-call checkpoint/replay benchmark passes its unchanged
8× input / 24× work bound (9.259× measured), with exactly 30,000 attempts and zero residual
work. These saved-simulation timings are diagnostics, not evidence of a saved-playback
speedup: that path does not capture checkpoints.

The existing profiled replay probe (12 backward-to-15 s / forward-to-60 s pairs) takes
27.81 s versus the bisect report's 28.30 s, with capture time 2.43 s versus 3.96 s.
These are separate diagnostic runs, not a controlled CPU speedup claim. The full engine
graph now uses the counted copier; remaining native clones are small runner/UI values.

Rejected: serialized snapshots increased seek latency, and an unshifted squared-age
score crowded retained checkpoints near the end and regressed the median. Mutable
topology, queues and accounting remain copied; sharing them would break isolation.
**Parity output is unchanged: zero golden changes.**
