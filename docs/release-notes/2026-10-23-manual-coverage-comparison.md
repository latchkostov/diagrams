## Manual coverage comparison

The merged/unsharded coverage comparison now runs only through `workflow_dispatch`, retaining
the exact-revision and strict per-file checks as an on-demand diagnostic. The one-time result
was 52,490 covered statements in merged coverage versus 52,493 unsharded, with the three-statement
difference confined to timing-dependent paths in `src/collab/session.ts` and
`src/collab/transport/relay.ts`. It is no longer an automatic PR check.

Retained additive lifecycle tests explicitly exercise targeted messages to waiting knockers,
queued frames during leave, late sealed-frame callbacks, and replaced relay authorization.
They use fake clocks, ordered barriers and controlled callbacks without weakening existing assertions.
There are no product output changes or changed parity goldens.
