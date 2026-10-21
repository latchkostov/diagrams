## CPU-bound standalone workers: UX review

Reviewed against the UX principles: sampled CPU-bound workers retain usable throughput
instead of appearing stalled at higher scale. This accounting correction needs no
additional controls, inspector fields, interaction changes or public showcase.
Existing public queue-worker examples already demonstrate standalone execution.
The fix shares ledger semantics across processors; a standalone CPU special case,
release-quantization changes and weaker accuracy assertions were rejected.
