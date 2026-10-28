## Broaden FrameDetail operation coverage after PR 370 fix round 1

Review findings R-f2b1dd69c4 and R-b1de1d18ca remain open. The current Custom-view
chain fixture selects one node, so it does not exercise growing Focus pins or
growing active-label placement. Its operation counter also excludes delegated
spatial and placement modules.

Add workloads with many off-pane one-hop neighbours and many selected edges with
distinct label geometry. Prove these paths execute, include delegated modules in
the count, and mutation-check full-scan collision queries and per-label layout
barriers. This needs a broader fixture than the Live camera gesture fix and is
deferred to keep that fix round focused. R-6e68e39be3 is resolved by measuring
identity with the actual viewport scale and testing long-title zoom reversals.
