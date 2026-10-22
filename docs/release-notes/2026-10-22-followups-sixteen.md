## Follow-ups 16

Request route controls now load below the connection's Simulation controls. Downloading optional
planning code leaves the waiting policy, timeout and pool controls at the position the user reached.
Pool details and run results resolve the caller stencil's default waiting policy, including workflows
with no explicit `wait`. Fixed fleets and traffic sources no longer receive a broker autoscaling summary.

Browser coverage pins editor focus and text selection after request findings arrive, module evaluation
after cancelled slow-motion loading, independent keyboard outcome opening, and the saved annotation
text captured by a retried PNG export. Request-only worker tests require nonempty findings, saved
scenario plans and identical worker-failure fallback. Callout tests reject a network timeout that
cannot preserve a healthy reply, and saved-simulation-only traffic must offer the next confirmed fix
when a zero-delivery replay cannot certify a timeout.

Checks browser setup passively awaits real background completion before asserting the rendered
findings. Retry still must restart its own failed check: no edit, forced flush or substitute result.

The failed-check Retry recovery was already merged in #230 (`046bac4a`). Historical library, fault-style,
viewer-scroll and Checks-card setup flakes were already fixed in `c3d15a42`, `86529d14` and `6d33c7d3`.
Their assertions remain intact.

## CI balance and output parity

Refresh all 125 spec timings from #230's final passing CI run `39739857776`, whose tested tree master
inherited at `046bac4a` (master run `39743181577` skipped E2E). The existing duration planner now
projects 1,537–1,539 test-seconds per shard: about 8 minutes 33 seconds with three workers, plus shared
setup/build overhead, near the nine-minute target. This is a projection, not a measured future job time.
Bundle budgets are unchanged. All 2,869 parity goldens are unchanged (1,695 node assertions and
97 browser cases); none were re-recorded.

## Verification

The full unit run passed 13,923 tests, with six existing expected failures and eight skips; targeted
coverage passed 183 tests. The six changed browser specs passed three native repetitions (120 cases).
After adding passive worker readiness, the two affected specs passed another three repetitions
(33 cases). Reverting the inspector placement and pool readout fixes fails both new browser regressions;
reverting run-summary fixes fails their new unit cases. Empty findings, lost plans, omitted network
delay and accepting an empty timeout replay each fail their respective coverage mutation.

Production build and size checks pass: entry 108.3 kB gzip against 123.5 kB, viewer 610.0 kB against
805.0 kB, and skill ZIP 834,144 bytes against the 835,000-byte cap. The initial Linux load attempt
exposed three background-worker setup waits; their assertions and timeouts remain unchanged.
A second load attempt was discarded after an overlapping native browser build replaced the served
chunk files, producing 404 and stylesheet errors. Subsequent browser builds and runs are serialized.

## Deferred

Target-scoped lookup of budget-omitted findings needs a bounded worker/cache contract. Choosing
authored lesson metadata versus neutral run summaries remains a product decision; both have backlog entries.
