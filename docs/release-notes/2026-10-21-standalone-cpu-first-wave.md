## CPU-bound standalone workers: PR #228 review fixes

Standalone processors use the same ledger predicate for first-wave CPU accounting,
CPU-tail ownership and thread retirement. Logical completion waits only for the
reserved wave; the remaining cohort CPU continues under its existing owner.
Retirement therefore scales each CPU duration once. Resource invariants now reject
ledger execution without first-wave CPU accounting or with CPU above its reserved weight.
Retries after an outage initialize their logical CPU only once they acquire a thread
and preserve the admitted cohort through live scale edits. Additional regressions
cover both transitions. Resource-enabling
tests now assert the exact first-wave completion while preserving every capacity-hold check.

The review's one-slot, 10 ms latency, 100 CPU-ms/request, 1000m CPU-limit fixture
receives 100 real requests/s for 20 seconds. Scale ten improves from 20 to 200
completions against the identical-arrivals scale-one reference of 198. Fractional
siblings improve from 181.5 to 199.1 at scale 1.1 and from 80 to 200 at scale 2.5,
both against references of 199. All four regressions fail on c39575a6 and pass
with the fix. The fixed I1 corpus remains 13/31; its test now enforces that floor.

No release quantization, I1 bound, parity golden or existing unit snapshot changes.
The generated skill viewer includes the corrected engine. No new controls or text
are added to the editor.
