## Live trace card interferes with edge-label context menus

Queued separately from the completed CanvasView split. In Live, the unchanged test `tests/e2e/text-fields.spec.ts:523`, “live keyboard and menu naming select all of edge-label-ab”, intermittently finds that a trace card covers the edge-label right-click, or that no edge edit-label menu appears after the right-click. Keep the existing naming behavior and assertions; resolve this independently of the pure module moves.

## Clean-master evidence

Earlier Linux comparisons on clean `origin/master` at `c5b901e9c68a73f046eb9919d0c9fffaee698165` and then `b13d4ccfc1f98dac891bca99ebb9537a0b7830ed` each produced 47 passed and 3 failed in 50 focused repetitions with 12 workers. The failures at line 541 report trace-card or trace-footer interception.

The resumed comparison on the same clean `b13d4ccf` source used four workers and 100 focused repetitions: 81 passed, 19 failed. It also reproduces the exact line-542 timeout waiting for `context-menu-item-edge.edit-label`. The checkout remained unmodified. Reports: `tests/.output/split-baseline-menu-shape.log` and `tests/.output/canvas-clean-master/tests/.output/g/baseline-menu-shape-WUh3EW/`.

## Refactor evidence

The granularity checkpoint's five Linux neighbour repetitions with four workers produced 1,014 passed and one failed. Its single failure is the identical line-542 missing-menu timeout, with an active trace card in the failure snapshot. All other cases passed, with zero retries. Reports: `tests/.output/split-granularity-linux.log` and `tests/.output/g/rBNj5GY/`.

No source, assertion, pointer coverage, camera policy or timing adjustment was made for this failure. The task explicitly permits continuing for identical clean-master failures; it does not make this test green.
