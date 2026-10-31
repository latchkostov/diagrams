## Bounded keyboard tutorial shards

The keyboard suite was one large spec with no measured entry in e2e-timings.json. The native whole-file planner assigned it the mean weight; the first round-three macOS shard reached its unchanged deadline with 41 named cases unfinished. Four spec files now register disjoint lesson groups against the same shared driver. Every previously covered lesson still runs exactly once. The existing boundaries and arrange keyboard exceptions remain; no skip or quarantine is added.

A completeness unit checks the actual four registrations against the canonical catalog. Temporarily restoring the original single-spec registration makes it fail. Linux at four workers/four CPUs ran all 53 lessons and the other six regressions twice (118 passes). The newly added note regression failed in both runs; its separate bounded-clock fix then passed five Linux repeats, with the full Webhooks path and regression additionally passing twice on Linux and Windows. This change preserves that committed fix.

The four weights are regenerated from those actual Linux JSON reports, including the repaired note regression, rather than invented estimates or changed deadlines. Shared driver extraction preserves all operations, predicates and exact assertions. No parity golden changes are expected.
