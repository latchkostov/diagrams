## Backoff completion sweep timeout on Windows

On 2026-10-25, the Checkout reference fix ran `pnpm test src/tutorials --maxWorkers=2`:
`Tests 1 failed | 2601 passed (2602)`. The only failure was
`completion regressions > backoff-budget: jitter fails the backlog expectation but the same seeded budget run recovers`,
which exceeded Vitest's existing 5000 ms hang backstop. The isolated test passed unchanged.

The completion-sweep spec was then run twice on clean `origin/master`
(`5f1dee035af65f8f5d3d583fc6d7007f68436be0`) in the same Windows worktree, Node 24.22.0, using
`pnpm exec vitest run src/tutorials/completionSweep.test.ts --maxWorkers=1`.
The first run reproduced only that same timeout:
`Tests 1 failed | 1775 passed | 38 skipped (1814)`.
The second run passed unchanged:
`Tests 1776 passed | 38 skipped (1814)`.
This establishes a pre-existing intermittent failure rather than a deterministic regression.

Follow up on the long synchronous simulation playback in that regression. Preserve its seeded backlog and goodput
assertions; do not relax them or raise the timeout. Checkout's entire completion contract and all 171 tutorial
production-build browser tests pass. No output goldens changed.
