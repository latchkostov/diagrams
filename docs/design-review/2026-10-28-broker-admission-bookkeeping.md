## Broker and admission bookkeeping UX review

Reviewed against the simple-by-default and chrome-budget rules. This engine optimization adds
no controls, settings, text or shortcuts. Live, Run simulations, retries, partial delivery,
resource edits and replay keep the same behavior. The cache tracks queue membership rather
than weights, so it cannot resize a sampled delivery on a scale edit. Existing output parity
and same-arrivals guards remain in place. No showcase is needed for unchanged behavior.
