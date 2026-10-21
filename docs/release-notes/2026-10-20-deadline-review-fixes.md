## Request deadline review fixes (#197)

The live trouble watcher resolves fallback response timing once per target node, so many
connections to one API no longer repeat endpoint and quota validation for each connection.
Saved simulations that explicitly disable an inherited timeout offer **Add a timeout** just
like calls with no timeout configured. Discarded late error replies no longer count an already
timed-out call as a second failure.

Leaving a fractional Timeout draft restores the saved whole-millisecond value and clears its
validation feedback. External value changes also clear stale feedback when replacing a draft;
an incomplete number that remains displayed keeps its feedback. Sampled queued-deadline cleanup
now has a normal passing test, separate from the documented expected accuracy failure.

## Output parity

No golden changes are intended or recorded in this review round, including every scale-one
golden. Existing sampling accuracy gaps remain pinned separately.

## Queued follow-ups

Endpoint-aware response estimation shared with planning, and fail-fast bounds on connection-pool
capacity, remain separate work. See the corresponding deadline review backlog fragments.
