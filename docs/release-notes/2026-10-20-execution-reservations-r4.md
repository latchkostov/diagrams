## Execution reservations across live transitions

W1 execution now acquires, recovers and releases thread and CPU ownership through
`src/sim/executionReservations.ts` for callers, callees and standalone processors,
including broker deliveries. Standalone work reserves its execution slot before CPU
resources are enabled; enabling resources reuses that reservation. Work retained
across a concurrency shrink shares CPU ranges while keeping its existing slots. Outage recovery
reacquires retained standalone work before competing traffic can enter. W1 execution
occupancy comes exclusively from the ledger, including numeric replica owners.
Quota charging remains admission's separate transaction.

Waiting callers and retained thread tails acquire idle physical ownership when
resources are enabled, without replaying finished local CPU. Retained broker tails
keep their delivery group and its assigned replica allowance.

The resource oracle checks each running W1 work item for its own live thread every
tick, including work without CPU resources. Focused regressions cover ten-slot
outage recovery, resource enabling with traffic queued before or after the edit,
reservation identity, quota-free execution waits, and exact grace-expiry outcomes
(one success and one failure, with all ownership drained). The command generator
adds resource enable/disable edits and standalone broker consumers alongside outages.

No goldens are intentionally changed by this review fix. Pre-W1 playback retains
its existing execution model. This fixes existing simulation behavior and adds no
simulation, planning or stencil feature requiring a new showcase.

## Review decisions

Rejected an execution-state fallback in occupancy: it would hide missing ledger
ownership and risk counting the same execution twice. Rejected quota charging on
recovery and resource initialization: these transitions resume existing work.
Assertions, timing limits and parity expectations remain unchanged.

## Expanded sweep

All 118 seeds pass: 100 fresh at 5×, ten fresh at 20×, and eight pins at 5×.
The expanded generator found two resource-enabling counterexamples, now fixed,
covered by focused regressions and included as pins (`-2109898723`, `393258053`).
The final summary is `118 passed, 0 failed, 0 unrun`; no golden is re-recorded.
