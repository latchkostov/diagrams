## Sampled caller thread reservations (R3)

Caller threads, request admission and connection pools share reservations measured in real capacity.
Logical outcomes remain separate from the sampled capacity hold. A blocking thread's turnover is
`T = H + g`, where `H` is its logical hold and `g = ADMISSION_LAG_MS` is the scale-1 admission lag.
Its exact release is `startActive + T * represented / weight - g`, bounded below by retirement.

Fractional releases carry their exact capacity availability into the next eligible ledger hold.
Only that hold is backdated; the logical attempt starts on its usual tick. Credits are scoped by
owner, reservation scope, edge and admission keys, merge at equal times, survive checkpoint replay,
and expire after the tick when unused capacity was available. Pauses freeze the owner's active clock.

The turnover regressions produce 777 versus 776 requests for four slots at scale seven, and 1,443
versus 1,440 for twelve slots at scale thirteen. Both are within one pool of dots. Local work keeps
its exact turnover even when a later logical completion bounds the release time. Mixed fan-out
continuations inherit the old hold's admission lag and do not charge their admission phase as work.
These fix the filtered nine-slot/scale-ten throughput deficit and the oversized mixed fan-out deficit
without changing either assertion. Pool wakes retain their post-reply dispatch phase, preserving the
frozen scale-one, divisible-pool and pause/resume traces.

Shrinking a live pool preserves existing reservation weights. Scale one already keeps four waiting
requests against one slot for about 60 ms after a 4-to-1 shrink. Timeline and live-edit regressions now
compare held occupancy with that reference at every tick (within one sampled dot), forbid admissions
while over the pool, check that queues cannot decrease there, bound processing by already-held
completions, and require monotone drain. Existing final counts, emptiness and checkpoint replay stay.

Exactly one golden changes: `node/sim/blocking-call/free-play.json` at scale ten. Caller occupancy
becomes the real reservation sum, 6.4 dots (64 threads), instead of seven rounded dots (70 threads).
The first three nonzero checkpoints complete one, one and three more caller dots; later checkpoints
complete five, sixteen and twenty-two fewer (final 1,391 versus 1,413, a 1.56% reduction). Correct
partial-capacity residence removes the rounded pool's excess capacity over the longer run, while
logical first-wave completion remains independent of the hold. Backlogs, downstream completion
counts, smoothed rates, event positions and latency summaries follow this scheduling change.
Both sampling goldens remain identical. Every pre-W1 and scale-one W1 golden, and all planning,
agent, checks, evidence, export, layout and route output, remains unchanged.
