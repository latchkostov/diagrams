## Cache-aside refresh caller preservation

Reviewed against the UX principles: refresh follows the same request semantics as
a cold miss, including required branches and failure propagation. Lookup labels
and addresses no longer silently change the refresh's meaning. No controls,
chrome, vocabulary, or layout changes are needed. An ended caller skips refresh
rather than starting a request with an invented type or address; the next live
reader can refresh normally. Checkpoint replay preserves both outcomes.
