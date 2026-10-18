## Latency percentiles UX review

The existing node badge and hover carry the feature. A sink's p95 replaces its throughput badge when
samples exist. Other consumers retain their default readouts, revealing p95 through Show ▸ Capacity.
There are no new top-bar, Live-bar, context-menu or inspector controls.

Hover shows a wrapping p50/p95/p99 strip, followed by “from N sampled messages · since restart”. The next
line shows waiting, work and travel shares. Scope copy explains successful async arrivals and that travel
is animation, excluded from the percentiles. The tooltip remains keyboard-discoverable through existing
node focus. Compact hover layout keeps the latency readout alongside the planning arithmetic.

The numbers describe root-to-node paths, including upstream waiting and work; they do not sum node
percentiles. A still-waiting order has no completion sample yet. A sample is a simulated message, even
when one dot represents 100 orders. Type caps and checkpoint storage remain implementation details.

The invented Kafka example provides a visible sink badge and a useful Billing hover in under ten seconds.
Its second simulation shows the 300 ms baseline. Narration anticipates the spike by one second and expires
before the final hover readout. The evidence tag requires configured work reachable from spiked traffic
without crossing a Request or dependency; its traversal is bounded even for cycles. New strings use t() and locale-aware
duration/percentage formatting; browser checks include English, Arabic and expanded pseudo-English.

Rejected: a separate dashboard, a Live-bar toggle, always-visible service latency badges, physical latency
claims for animation travel, per-hop percentile composition, and request completion or expectation metrics
in this PR. They would add chrome or exceed the measurement scope approved for PR 1.
