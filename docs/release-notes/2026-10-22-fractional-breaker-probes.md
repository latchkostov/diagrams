## PR #245 review: fractional half-open probes

Half-open batches now finish when their admitted real units have settled and the shared allocator cannot admit another real request. Fractional cohorts no longer leave a healthy connection permanently Testing. The existing whole-dot admission rule remains bounded by the batch plus less than one cohort; the independent R3 oracle now checks the room before each admission. Ignored, cancelled and shed probes settle without health evidence; an inconclusive batch waits another open interval.

Recovery verification measures successful logical calls on the affected request edge for both goodput and post-fault work, including asynchronous and broker-fed callers. Fault tracking covers the feeding path, synchronous descendants and enclosing boundaries, and ignores disconnected services. Oversized replays are rejected before topology traversal; accepted ancestor searches use node and adjacency indexes.

The download-error callout shares collision-aware placement and Fit-view overlay registration. The Inspector edits breaker windows in whole seconds (1-60), maps them to milliseconds, and explains invalid fractional input through its associated validation message. No controls were added. The download-error component loads only when needed, preserving the Live bundle boundary for optional callout placement.

Regression controls restore af749e57 and demonstrate failures at scales 1.01, 1.5, 2.5 and 10, scale-three competing consumers, generated eventual recovery, inconclusive probes, oversized admission, asynchronous/broker recovery, disconnected faults and oversized topology. Both UI regressions fail against the original production build.

No parity golden has been re-recorded for this review round.

The requested sweep passed all 40 ordinary seeds but hit the existing CI hang backstop on four heavy seeds. The same property times out twice on clean origin/master with the identical heavy seed and workload; see [the follow-up](../backlog/2026-10-22-heavy-resilience-sweep-backstop.md). No timeout or assertion was loosened.
