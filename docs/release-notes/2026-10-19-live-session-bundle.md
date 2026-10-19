## Live session download budget

The message trace card now downloads when a trace opens, using the existing retryable lazy loader.
Opening Live no longer downloads that card. Simulation execution and checkpoint behavior are unchanged.

The production bundle benchmark measures gzip bytes before the change and after syncing with current master:

| Download          |    Before |     After |
| ----------------- | --------: | --------: |
| Live session      | 135,406 B | 132,147 B |
| Startup           | 176,471 B | 176,482 B |
| Canvas first view | 380,804 B | 380,846 B |

Live has 2,853 B of headroom beneath its unchanged 135,000 B budget. Small startup and canvas differences
come from emitted chunk references. A production-build regression covers both collaboration configurations
and verifies that the card remains available on demand. No parity golden changes are intended or recorded.
