## Pre-existing resource recovery invariant

The PR #247 forwarding review sweep found a resource/concurrency recovery invariant already present on clean origin/master `39af0c91eae340bf903313456533069b9aeb3cd9`. The failing test is `src/sim/ledger.commands.test.ts`, `scaleOne=false`.

Seed `-677367209`, multiplier `20`, fails after 612 generated cases with `standalone @50: new reservation exceeds replica concurrency`. Both the review branch and a clean archive of that master commit reproduce the same failure twice. Each targeted replay reports `Test Files 1 failed (1)` and `Tests 1 failed | 3 skipped (4)`. The archive lives under this checkout's ignored test output and uses the same locked dependencies; no other worktree was changed.

Reproduce from an installed checkout (Node 24):

```sh
CI=true FC_SEED=-677367209 FC_RUN_MULTIPLIER=20 node node_modules/vitest/vitest.mjs run src/sim/ledger.commands.test.ts -t 'scaleOne=false' --maxWorkers=1 --typecheck.enabled=false
```

The minimized sequence injects three messages into a broker-fed graph at scale four, changes scale to one, checkpoints, then recovers/enables resources with concurrency one. Resource recovery must reconcile existing replica reservations with the new concurrency before a subsequent reservation is admitted. The full reduced diagram and command sequence are printed by the replay; the original sweep's shrink path is:

```text
611:4:3:5:3:3:4:4:4:4:4:4:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:5:8:8:14:14:14:17:17:17
```

## Scope and evidence

The forwarding review leaves resource reservation policy unchanged and preserves all simulation parity goldens. This independent recovery bug needs its own minimized regression and fix. The complete requested sweep reports `SUMMARY: 42 passed, 2 failed, 0 unrun; 1324.68s`: one heavy seed exposes this invariant, and two heavy jobs hit the existing resilience-test hang backstop under six-job load. Replaying only those resilience seeds (`-677367209`, `217339446`) with multiplier twenty and two jobs passes: `SUMMARY: 2 passed, 0 failed, 0 unrun; 63.67s`. No timeout or assertion changed.
