## PR #271 checks typing investigation

CI run 40067344357 failed the held/running CPU ratio. No check-specific per-key regression was found.
Compared master `9b673f63` and branch `583ffef6` sequentially in this worktree, each with identical
DevTools render instrumentation and ten Linux repetitions: pinned Playwright noble image, one browser
worker, two CPUs, production E2E builds, 21 matched-prefix pairs per repetition (210 pairs per revision).
Command: `pnpm gate quick tests/e2e/checks-ui.spec.ts:339 --only e2e --linux --repeat 10 --workers 1 --cpus 2 --max-wait 1 --ports 6720`.
The selected line includes the temporary instrumentation import. Both summaries reported 10 passed,
0 failed, 0 flaky. Raw local reports: `tests/.output/g/rZYW03x` (master), `tests/.output/g/rShzLTU` (branch).

| Revision/mode   | Thread CPU ms p10 / median / p90 | Median renders / commits per key |
| --------------- | -------------------------------- | -------------------------------- |
| Master, held    | 66.87 / 74.06 / 93.46            | 99 / 3                           |
| Master, running | 69.91 / 90.72 / 98.53            | 99 / 3                           |
| Branch, held    | 67.33 / 72.41 / 91.20            | 99 / 3                           |
| Branch, running | 72.20 / 89.53 / 95.29            | 99 / 3                           |

Per-run CPU median ratios ranged 1.066�1.297 on master and 1.043�1.271 on the branch. Thread CPU
readings include the identical render hook; they are investigation samples, not an uninstrumented
benchmark. Rare extra commits occurred in both modes/revisions: master had one held and one running
outlier; branch had three held and four running outliers. Every repetition's median remained 99 / 3.
The failure itself did not reproduce, so these runs establish matching work and overlapping distributions,
not a claim that all possible timing variation is explained.

## Source review and decisions

The registry registers each surface at module initialization. Its subscribers observe surface load
state, not editor/check-store updates. `ensureLoaded` runs from a mount effect; output readiness is
entered by capture/export, not keystrokes. The added surface `interaction.rendered()` call returns
immediately without a pending focus move; it does not send machine events. The checks scheduler,
runner and measurement helpers were identical between the two revisions before this fix round.

Rejected speculative subscription/memoization changes: there is no measured check-driven render
increase to fix, and surface readiness/focus behavior has its own lifecycle requirements. Rejected a
larger CPU allowance: the original 1.5 threshold and paired workload remain in the Benchmarks suite.
CI instead checks exact equality of same-run median renders, per-component renders and commits,
plus exact starts/finishes/worker posts, no worker failures, no in-sample publication and no planning
work. Median operation counts tolerate the isolated background commits observed on both revisions;
a systematic extra check-driven render still fails. No controls, layout or user-facing text changed.

## Verification

The count guard is checked with a deliberate extra checks-result publication before each worker run,
then that production mutation is removed. Final targeted Linux results and the mutation outcome are
recorded in the release fragment. Full suites and parity are deferred to CI for this targeted fix round.
