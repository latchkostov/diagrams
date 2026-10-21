## Engine R5 lock-in

Correct sampled thread holds for callers with zero local work: admission already starts them, so
an extra admission-lag tick incorrectly reduced throughput. Named regressions cover scales 1.01
and 2.5. Add a gated 10,000-open-call ledger benchmark, strengthen CPU-tail grace and broker
continuation coverage, and cover playback and Retry during lazy downloads. Delayed narration
now preserves keyboard focus in an open menu, including independent Live popovers.
Document real units, weighted reservations, CPU tails, recovery and sampling limitations.

Full generated I1 scale equivalence and the wait-test wrapper rework move to the dedicated
[Sampling accuracy work item](../backlog/2026-10-20-engine-r5-i1-counterexamples.md).
Four named expected-failure regressions preserve the measured gaps: queue-worker service credit
1,998 → 1,008.99 at scale 1.01; managed admission/holds 666 → 335.32 at scale 1.01;
fractional fragmentation 1,998 → 1,098.9 at scale 1.1; equal one-slot services with 1 ms work
499 → 400 at scale 2. Existing generated properties and assertions remain as on master;
no quarantine predicate filters their coverage.

The benchmark keeps 10,000 sampled calls open at scale ten and checks the count before and after
measurement. Its same-process baseline has 1,250 calls; the standard 24× growth ceiling for 8×
input allows linear work and runner noise while rejecting quadratic scans. Millisecond timings
remain report-only; no machine-specific latency budget is introduced.

No output golden changes are intended. R2–R4 changed only
`node/sim/blocking-call/free-play.json`; their complete direction notes are in `docs/PARITY.md`.
No new controls, UI text, simulation feature or bundle budgets.
