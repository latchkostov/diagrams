## Message loop analysis quarantine (PR #247)

Two P1 findings in the review of `50ee144f` are quarantined. No new path or temporal analysis is added.

### Converging sources can hide lost deliveries

Repro: A and B sources feed API -> Sender. Sender returns only A to API and forwards to Audit.
A third source sends A directly to Sender. The transition-membership verifier offers **Only pass B**
on API -> Sender because the third source keeps Sender(A) -> Audit(A) in the global graph. Injecting
only the original A source reaches Audit before the edit and never reaches it after the edit.

Checks retain the loop warning and manual guidance, but offer no automatic filter or rename in any
configuration. The existing verifier remains in `src/checks/messageLoopFix.ts`, unused by Checks.
A proper fix must prove delivery preservation per input and path/provenance, including first-pass
exits, converging sources, request routing context and every saved run. Global transition membership
is insufficient. Candidate replay and provenance expansion must stay within the shared work budget;
uncertain or exhausted proofs must continue to withhold fixes.

### Timeline forwarding edits can introduce undetected loops

Repro: a source sends Loop to API -> Sender -> API. API initially emits Stop and the return link only
passes Loop. A saved simulation changes API emits to Loop at 0 ms and injects a burst. Playback
circulates through both processors, but static extraction previously returned no loops and
`complete: true` because it read injections and setup without applying timeline props patches.

Scenarios with forwarding-relevant timeline props edits (emits strings/maps, filters, source types,
traffic mixes, route tables, request filters/routes, share or deny) now mark the aggregate analysis
`complete: false`. Own-property presence includes clearing a setting. Checks retain their omitted
analysis indication rather than claiming clean. Unrelated latency edits and timeline injections remain
supported. Static carried types and detected loops remain partial information.

A proper fix needs shared, ordered timeline patch handling consistent with playback: setup first,
then patches and injections in event order, including replacements/clears, repeated edits and traffic
already in flight. Analyze only configurations and temporal paths that can be established within the
shared work budget; otherwise retain incompleteness. Do not simply union configurations into paths
that never existed. Add playback comparisons and budget regressions before lifting this quarantine.
