## Cache activation rewinds and checkpoint storage

Rewinding before a timeline step that enables a read-through cache now restores outcome
classification too. Reply particles in the earlier part of the run retain their original
codes and failure markers, even after playing past the activation step.

Checkpoints retain cache rule state in lossless numeric payloads, using sparse storage for
mostly empty arrays and dense storage when smaller. Restore reconstructs independent mutable
state while preserving references from in-flight work to its rule. Counts, random streams,
statistical freshness, tracked expiry and fetch arrays, rate buckets, fetch samples and
warm-up timestamps are all retained without rounding.

The checkpoint increment is 6,228 bytes for the single-node 4,096-item fixture, 98,976 bytes
for 256 initially loaded rules, and 107,344 bytes after all 256 rules handle a successful
miss and drain (also tracking 4,096 items). The last fixture previously needed 285,344 bytes.
The existing 130 KiB bound remains unchanged. Both review regressions fail when their fixes
are temporarily removed. No parity golden changes are intended or recorded.

No-cache replay checks retain every fixture, simulation, tick and assertion, with separate tests per
saved simulation. CI runs this workload in its build lane so the serial heavy lane retains its
existing deadline; test backstops and CI deadlines are unchanged.
