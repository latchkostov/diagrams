## Transport and admission extraction exceeds the size allowance

The lane B candidate moves transport and admission out of `engine.ts`, retaining
the tick skeleton, scalar names, restore accessors and positional function ports.
It is not ready to commit or publish: its production bundles exceed the split's
200 B per-chunk and 1,000 B total app JavaScript gzip allowances.

Measured against merge-base `c59c2127fd6e0403df02c117a3f204f30e9328d7`, using Node
24.22.0, production app/viewer builds and level-nine gzip:

| Output               | Raw delta (B) | Gzip delta (B) |
| -------------------- | ------------: | -------------: |
| LiveSession chunk    |             0 |            +10 |
| Simulation           |          +977 |           +574 |
| Simulation worker    |        +1,103 |           +663 |
| Evidence worker      |        +1,087 |           +649 |
| Viewer JavaScript    |        +1,091 |           +699 |
| Total app JavaScript |        +3,167 |         +2,114 |

LiveSession including its static imports grows by 612 B gzip; its additional
download beyond the canvas grows by 601 B. The skill ZIP is 828,326 B, leaving
6,674 B below the strict 835,000 B ceiling. No budget or golden was changed.

The isolated production bundle contract also fails: its canonical Live additional
download is 132,170 B gzip against the pinned 132,000 B maximum. The version and
review-loop tests pass in that same isolated run (70 passed, one size failure).

Revise the extraction seam before publishing. Named function-port objects remain
excluded. Grouped mutable state and indexed state tuples increased bundle size
and caused broad source churn, so those experiments were reverted. Lifting
closure-free helpers also failed to meet the allowance. Do not compensate with
an unrelated trim, compression change, field rename or cohort algorithm change.
