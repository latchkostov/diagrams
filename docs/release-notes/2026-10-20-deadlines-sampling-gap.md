## Deadlines shipping scope

#197 is rebuilt on the R1–R5 attempt ledger. At scale 1, calls that time out while waiting
for a connection are never sent; only work already dispatched can reply late. The engine
keeps the deadline behavior from `e4c686b8`, with R5's zero-work admission rule preserved
when rebasing. No partial-cohort implementation is included.

Pooled calls with deadlines at scale > 1 are the fifth known sampling gap. The I1 fixture
reports 2,964 completions and late replies at scale 1 versus 330 at scale 10. Three
accuracy-specific expected failures pin the two burst regressions and continuous I1
comparison. Simulation, replay and cleanup checks execute outside the expected-failure
bodies, so an unrelated crash fails the suite. Scale-1 assertions and the original #197
tests remain passing; the sampled deadline-ledger expectation is unchanged.

The gap is fixed by the sampling-accuracy PR, following the
[cohort design](C:/Users/latch/bin/codex-tasks/rtw3-queued-cohort-design.md).
See the [tracked follow-up](../backlog/2026-10-20-deadline-queued-cohorts.md).
Use scale 1 when the pool/timeout boundary matters. The existing public payment lesson
still demonstrates bounded waiting within ten seconds; this shipping decision adds no
simulation or control needing another showcase.

## Golden review

This shipping decision changes no golden. #197 carries 60 new goldens for the public
payment example and frozen deadline corpus. All existing diagram outputs, including
scale-1 outputs, remain unchanged. The four scale-10 deadline records changed during
the ledger rework are explained individually in
[the ledger release note](2026-10-20-request-deadlines-ledger.md#output-parity).

Relative to master, exactly six shared goldens change: `node/agent/tools.json` records
expectation metrics and nullable deadline overrides; `node/skill/public-schemas.json`
records their schema fingerprints; `node/skill/files.json` records the generated spec
fingerprint; `node/skill/current-stencils.json` records the example ranking;
`node/skill/validate.txt` adds the deadline corpus validation line; and
`node/i18n/catalogs.json` records ten new English messages and their hashes/fallback counts.
No golden is re-recorded to accommodate a failure.
