## Hover-card deletion test readiness

The failing assertion in CI run [40199018405, attempt 1](https://github.com/latchkostov/diagrams/actions/runs/40199018405/attempts/1)
is the unpinned readout after Undo, not the canvas-focus recovery. The trace shows the restored
`node-caller` while `node-badge-caller` is absent throughout the hover. Both camera and interaction
state are already idle. The badge appears later, but no second pointer event opens the card.

The canvas restores its node before Live's debounced structural synchronization restores its
simulation snapshot. `NodeBadges` renders the badge only for a node present in that snapshot;
its readout reconciliation also requires that snapshot entry. A hover before synchronization is
therefore ineligible. Waiting for focus or camera idleness alone cannot establish readout readiness.

The test now waits for the restored node's Live badge before hovering. The edge case stays unchanged:
edge readout eligibility follows React Flow's edges rather than a node snapshot. All deletion,
readout removal, canvas-focus recovery and unpinned restoration assertions remain intact.

## UX review

This is a test-only synchronization correction. It retains the existing pointer interaction and
focus contract, with no product controls, copy or behavior changes. Product focus-policy changes,
longer timeouts, sleeps and retries were rejected because the failure is a missing readiness boundary
in the test. No output goldens are edited.

## Verification

The pinned `mcr.microsoft.com/playwright:v1.64.1-noble` image runs the production E2E build with
six workers on three CPUs, zero retries, ports 6720–6724:

```sh
pnpm gate quick tests/e2e/hover-cards.spec.ts:711 --linux --only e2e --repeat-each 30 --workers 6 --cpus 3 --ports 6720 --max-wait 1
```

Before the fix: 27/30 node runs passed, 3/30 failed at the same post-Undo assertion as CI;
30/30 edge runs passed. With the fix: 30/30 node and 30/30 edge runs passed, with zero failures
or flaky cases. Removing only the badge-readiness wait for the mutation check brought back
9/30 node failures at that same assertion; all 30 edge runs still passed. The wait is restored.

Only the named targeted cases and static checks run locally in this fix round; broad suites and
output parity are left to PR CI. No output goldens change.
