## Engine resources and broker boundary

This internal extraction adds no controls, terminology, inspector fields, UI messages or examples.
The chrome budget and interaction paths remain unchanged. A showcase example would imply a new
simulation feature; this change intentionally has none.

Live retains its existing phase ordering: fleet advancement, early releases, conditional arrivals,
one ordered node loop with pre-service resource preparation and the existing service loop, both
CPU-tail charging positions, resource integration, reassignment, logical drain, late arrivals,
fleet admission, broker pulls and final accounting. The typed scratch tuple retains the pre-service
occupancy and fleet/resource identities through each node's turn; restore-aware accessors read the
current roots. Phase functions are wired once, with no per-node phase callback registry.

The resource/broker characterization pins internal-tick observations and dispatch order, including
pause/resume, replica and scale edits and repeated restore. Both deliberate ordering and accounting
mutations are detected. Full output parity compares 3,178 goldens without any changes, protecting
canvas, particles and the exported viewer as well as simulation results.

The existing execution adapter's parameter and result wiring is positional so the minifier can
rename it. Its execution bodies and data fields remain unchanged. The split meets every size target;
the Live bundle's remaining 4 B of headroom is recorded for a dedicated trim rather than changing
this PR's behavior or raising a budget.

Rejected: reordering node passes, changing cohort algorithms, renaming parked-branch fields, adding
named port objects or per-node phase callback registries, raising size budgets, changing compression
policy or rewriting goldens to conceal a difference.
