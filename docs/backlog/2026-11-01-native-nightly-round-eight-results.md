## Pre-existing Linux CI exception

PR #419's first CI run, [41361069377](https://github.com/latchkostov/diagrams/actions/runs/41361069377), fails `collab-c0.spec.ts:259` in E2E shard 2. After double-clicking a node, pressing End on the Inspector resizer leaves it at 372 px instead of above 640 px. Its remaining assertions do not run.

The same exact failure reproduces in a clean detached checkout of `origin/master`, 5c22a5d42846b57a2dd3fe598a329a0af2f6441b, in this worktree. Only `collab-c0.spec.ts` runs, twice, in Linux with six workers sharing four CPUs. The first repetition has nine passes and the identical 372 px failure; the second has ten passes. No full master suite runs. The branch is restored afterward, with no stash, rebase or other worktree.

```text
SUMMARY: 5c22a5d42846b57a2dd3fe598a329a0af2f6441b | unit="not run" parity="not run" e2e={"passed":19,"failed":1,"flaky":0,"skipped":0} gate_failures=1
```

Record this as a pre-existing exception. Keep the test and exact width assertion enabled. Investigate the double-click's pending Inspector naming/focus handoff before the resizer key; the CI trace shows the handle's valid maximum is 960 px, but its value never changes from 372 px. There is no skip, retry, timeout or workaround. Every other first-run PR CI check passes, including merged coverage, heavy tests, parity, benchmark gates, build, size, lint, types and format; the aggregate CI check retains the shard's failure.

## Dispatched branch verification

Nightly [41361042610](https://github.com/latchkostov/diagrams/actions/runs/41361042610) tests product/test head 5ee28ba26f8ec98759c96903f618ec32ce46b053. The final verification-record commit changes documentation only; application and test bytes remain identical to that tested head. The ready PR is [#419](https://github.com/latchkostov/diagrams/pull/419).

Windows has completed: 3,326 passed, 13 failed, 15 existing skips, zero flakes and zero unfinished. Both the original phone showcase and new selected-node/focus/next-key regression pass. The held-verification case reaches every exact count, revision and Capacity assertion, but is recorded as an overall test-limit failure: opening Live takes about 11 seconds, fake-clock execution nine, and verification six, in addition to edits. The original reply-count assertion race is repaired; this cumulative native duration failure remains unresolved. No deadline is raised.

The dispatched run completes with this E2E inventory. Native platforms and Linux Dev each cover all 3,354 cases; Build covers the same inventory three times. Every report has zero flakes, unfinished cases and reporter errors. All skips are existing platform/project choices; none is added.

| OS / mode      | Passed | Failed | Existing skips | Unfinished |
| -------------- | -----: | -----: | -------------: | ---------: |
| Windows        |  3,326 |     13 |             15 |          0 |
| macOS          |  3,334 |      9 |             11 |          0 |
| Linux Dev      |  3,304 |      0 |             50 |          0 |
| Linux Build x3 | 10,029 |      0 |             33 |          0 |

All eight Dev and twelve Build shards pass. All twelve native unit/heavy shards pass, six per OS. Both original phone showcases and both new phone regressions pass. Held verification passes on macOS, Dev and all three Linux Build repetitions; the Windows overall-limit failure above remains. The light/dark accessibility audits pass, including the relationship scopes. No colour-token change is justified by this run. The protected keyboard edge-navigation camera rule and low-zoom review remain untouched; Linux's low-zoom comparisons pass all three repetitions.

The source fixes are separate signed commits, 63edd001632aa395be9f94ef015a545280e4008d and 5ee28ba26f8ec98759c96903f618ec32ce46b053, each pushed immediately with a normal fast-forward push. This final record requires only fragment validation and final static/format checks; it does not repeat the full Nightly for documentation-only changes. Full output parity on the unchanged implementation passes all 3,178 goldens without re-recording any.

## Remaining investigations, product behavior first

- Persistence and sizing: macOS `annotations.spec.ts:910` reloads a 20,000 px annotation at 9,238 px. Windows `ai-dialog.spec.ts:206` restores the node after Undo but does not render it visibly within the assertion window. Establish the stored dimensions and measurement state before treating either as a driver race.
- Camera and focus: macOS `keep-camera.spec.ts:75` journals `zoom100`, then a later `focusSelection` at 90%. The wide-Inspector Shift-box case in `round13-polish.spec.ts:284` starts its drag at x=-252 despite asking to fit first. `workbench-narration.spec.ts:3` finds an off-screen call pill. All twelve Windows reproductions of those three cases pass; native macOS failures remain. The Request disclosure in `lazy-retry-trim.spec.ts:67` loses focus before its held fields load, and `relationships.spec.ts:616` fails to expose the hidden dependency list after focusing its pip. The protected keyboard edge-navigation rule remains unchanged.
- Replay and readouts: Windows tutorial imports, the held waiting renderer, saved-simulations, study-rag Continue and study-cells; macOS quick-add's grow step and study-payments' never-double-charge step; Windows Inputs readiness and the verified busy-thread planner suggestion. Windows latency hover (the brief's line 244, currently 246) still fails to open its readout. macOS presentation Home scrolling stops at 45 px instead of zero.
- Capture, export and cumulative work: Windows worker captions, main-renderer recording layers, sandboxed HTML download, and the held-verification whole-test limit remain enabled and unresolved. Full Linux low-zoom comparisons pass; no speculative export optimization or deadline change is shipped.

The remaining groups need causal verification. Newly observed macOS sizing/camera cases still need a master reproduction; a single Nightly does not establish flake rates. Both phone regressions pass on dispatched Windows and macOS; the original request-count race is separately distinguished from its remaining cumulative duration failure.
