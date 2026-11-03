## Full fetch-sample rings stay within the checkpoint bound

Cache checkpoints now encode integer state compactly, with an exact floating-point escape for
fractional values and signed zero. The 256-rule regression fills every 32-slot fetch ring and
retains all 4,096 tracked items. Before the fix its checkpoint increment was 185,424 B; the
compact representation uses 71,053 B against the unchanged 133,120 B bound. Replay remains exact.

The checkpoint-only commit passed all 3,282 parity goldens with no changes. No budget or limit
was increased.

With the subsequent cache-window and split-latency readouts enabled, the same full-ring fixture
uses 116,729 B of additional checkpoint storage, still below the unchanged bound.
