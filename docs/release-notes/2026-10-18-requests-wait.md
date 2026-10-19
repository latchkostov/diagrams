## Requests that wait

New diagrams use model `p3-w1`. A Request keeps the caller's existing thread until all parallel replies return. Messages and the upstream reply follow the join. Failures return upstream, including route refusals; broker deliveries still retry and dead-letter. Calls use simulation time and physical network delay, with animation echoes drawn after their causes. A gateway passes the call through without retaining a thread. Depth and open-call limits bound cycles and runaway graphs.

Older diagrams retain their revision and playback. Diagram properties offers a capacity preview and a single undoable upgrade, including saved simulations. Legacy export warns about the loss of request waits. Clipboard v2 retains caller settings as dormant values in older targets.

A thin node meter distinguishes working threads from hatched waiting threads. The existing badge strip shows a busy chip at 80%; hover adds Threads and the steady-state Ceiling equation. Capacity planning includes the slowest parallel call. There are no new top-bar or Live-bar controls.

The public **A blocking call caps throughput** example fills Decision service's 64 threads within ten seconds. Applications accumulate while its CPU scaler remains at four replicas. CPU sharing and simulation ticks can make observed throughput lower than the ideal steady-state ceiling.

## Scope

The staging table assigns connection pills, non-blocking controls, the capacity-preserving upgrade alternative, and the latency split to PR 2. They are deferred together. Deadlines, connection pools, busy-thread scaling, trouble actions, Checks and agent explanations remain in their later PRs. No dormant deadline, retry or pool setting gains execution here.

## Output parity

The frozen `w1-*` corpus adds blocking, parallel failure, gateway pass-through, a deadlocked loop, held-replica drain, and exact versus sampled runs. The public blocking example adds the usual diagram, simulation, planning, checks, trace, layout and export records. Existing diagram-output goldens must remain unchanged.

`pnpm parity:update`: **2,672 goldens, 4 changed, 142 added, 0 missing, 0 removed**. Every older diagram's simulation, planning, trace, checks, drawing and export record is unchanged. The four changed shared records are:

- `node/skill/public-schemas.json`: diagram v2 accepts `p3-w1` as an A1 successor; older revision restrictions remain in place.
- `node/skill/current-stencils.json`: the new public example changes the usage ranking of existing generic stencils.
- `node/skill/validate.txt`: six valid frozen W1 corpus diagrams join the aggregate validation inputs.
- `node/i18n/catalogs.json`: sixteen English source messages add the Threads/upgrade copy and example labels, with English fallback in untranslated catalogs. Only the corresponding area fingerprints and counts change.

The 142 new records cover the six W1 corpus diagrams (including two sampling runs), explicit held-slot/reply histories, and the public example's existing output tiers. No golden was changed to accommodate a regression.

## Verification and review

Engine and upgrade regressions cover acquire/release, pending work, nested and parallel replies, failure propagation, broker retries/DLQ, route refusals, depth limits, paused callers, replica drain, sampled slots, checkpoint replay, endpoint duration and undo. A fast-check property varies workload, capacity, latency, failure, fan-out and scale. Removing the W1 engine gate fails twelve new regressions; removing the CPU-target guard fails its regression.

The initial full unit run exposed the new example's required traffic metadata, catalog/precision registrations, and intentional failing-lag expectation. All affected suites were corrected and rerun. A compact-hover browser regression exposed the hidden Ceiling line; the visibility assertion now passes with Threads/Ceiling above latency. Visual review also caught and corrected a duplicated rate unit. Production browser coverage passes all four W1 tests.

The existing CPU-target recommendation is withheld on waiting callers: lowering that target does not repair a thread ceiling. Busy-thread scaling and its replacement recommendation remain in PR 4. No new Check kind or agent readout is introduced here.

An additional failing probe caught a waiting broker delivery releasing its slot for one tick when it entered an in-place retry. It now returns directly to working backoff with its lease and replica intact. The regression covers resource-free and resource-enabled callers, backoff occupancy and eventual release; no golden changes.

The busy chip stays quiet for an empty, zero-replica caller pool. Its production-browser regression fails before the non-zero occupancy guard and passes after it. An initial bind-mounted Linux load run was invalidated by a concurrent native E2E rebuild; verification was restarted from an isolated committed archive.

Future animation echoes stay hidden until their scheduled start, so a logically completed reply cannot appear before its preceding dot arrives. A simulation-clock regression rejects the previous progress-zero echo. The isolated Linux load run completed all five repetitions: 545 passed, 0 failed, 0 flaky.
