## Tutorial blueprint insertion parity (R-6cc56305b9)

Queued from PR #410 review round 1. The insert-on-edge blueprint duplicates insertion semantics and loses
the authored connection label. Retain model edges during projection and call `src/model/edgeSplit.ts`'s
`splitEdge` before converting to preview edges; keep numbered markers separate. Extend the insertion
regression to assert the original identity and label on the first half. This follow-up is outside the
requested finish-sheet fix round.
