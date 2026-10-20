## Engine CPU share and callees R4

A sampled call participant executes the CPU of its reserved real requests: weight times CPU per request.
Logical completion can answer upstream while remaining cohort CPU continues consuming the same bounded
CPU budget. Positive CPU tails survive logical completion and checkpoints, and stop on shutdown or
expired drain grace. CPU-free capacity tails are absent from the CPU loop.

Processors receiving eligible Requests now use the same thread and request ledger as callers. Their
capacity no longer uses service credit. Older revisions, processors outside the call graph, and network
device throughput ceilings keep their existing credit path.

A scale-one replica must return to the sampled ready ranges after its last original owner releases it.
This fixes empty CPU ownership after paused scale transitions, including zero-CPU work. Recovery that resizes a reservation preserves CPU progress per request without changing the cohort total. Continuations
use the preserved request weight when a live scale edit changes the next dot's size. Admission policy
edits update only affected limits and retained excess; full-request admission tolerates subtraction
roundoff within the existing float tolerance. The sweep launcher reserves shared gate worker capacity.

Exactly one golden changes: `node/sim/blocking-call/free-play.json`, scale ten with CPU resources.
The fastest traced journey drops from 690 to 680 ms and minimum caller processing from 270 to 260 ms.
Remaining cohort CPU now competes after logical completion, changing later admission timing. Caller
completions fall by 3, 11, 19, 22, 18 and 20 dots across checkpoints (final 1,371 versus 1,391, 1.44%
lower). Thread occupancy stays at 6.4 dots, representing 64 threads. Downstream counts, backlogs,
rates, event positions and the seeded latency sample follow this schedule, with no new failures or
drops. Final in-system dots rise from 1,021 to 1,039. Both sampling goldens, all pre-W1 and scale-one W1
goldens, and every planning, agent, checks, evidence, export, layout and route golden stay unchanged.
`docs/PARITY.md` records the same direction.

Regression proofs cover CPU share, call-target admission, idle-replica handoff, continuation weight,
floating admission and ledger room, incremental limits/excess, shared-cap recovery and sweep lease
lifetime. Shrink also preserves pending own-work CPU without charging a queued continuation early;
drain grace keeps range identity until the logical call has settled.
Previous-step CPU continues through retry backoff and continuations; shutdown cancels that prior tail
while preserving the current retry. Recovered non-blocking broker continuations reacquire their group
slot, and returning to scale one before shrinking retains draining replica ownership.
Failed resource acquisition leaves CPU uninitialized until execution owns capacity, so a queued
scale edit cannot strand a cohort with the previous scale's CPU total.
Enabling CPU resources on an already admitted partial call initializes its first-wave budget from
the retained thread weight, without charging later waves during that first wave's I/O.
After a paused shrink, an arrival that already owns execution admission runs before an unreserved
continuation needing those same keys; neither queue can strand the other's capacity.

The final sweep passes all 116 seeds: 100 fresh at 5×, ten fresh at 20×, the three required pins and
three newly pinned counterexamples, with CI's timeout unchanged. The sweep budget helper accepts
caller-supplied metadata, so its lease tests also run in source archives without Git metadata.
Final unit, parity and gate results are recorded in the pull request.
