## Cursor affordances through deferred notifications

The production CSS cascade must retain the existing affordances: move on diagram nodes, default on
the editing pane, grab on palette tiles, pointer on category buttons and text in palette search.
The new browser guard checks each state through a held and released toast renderer with the library
pinned, using existing controls and test IDs. No controls or chrome are added.

Matched-rule inspection on Linux found React Flow's later `.react-flow__node.draggable` rule winning
over `.react-flow__node-diagram.draggable`, and its pane selection rule winning over the app's default.
Both have equal specificity. Keeping CSS out of the script compression group restores their order.
Increasing node specificity was rejected because it would mask the ordering fault and leave other
overrides, including the pane, broken. The toast renderer remains deferred; budgets stay fixed.

## Focused verification

All four requested browser specs passed three Linux repeats with four workers and three CPUs:
129 passed, zero failed, zero flaky. The bundle-splitting heavy spec passed all 27 tests, including
the unchanged canvas reserve assertion. Temporarily restoring the old grouping made the new guard
fail with `grab` instead of `move`; the other six toast-loading tests still passed. The fix was then
restored exactly. Full suites and parity were left to CI under the fix-round verification scope;
no goldens were recorded.

The original two cursor checks passed on Windows but failed on Linux. An exploratory Windows prebuilt
probe timed out at navigation; its explicit port was already serving another checkout, so it is not
verification of this tree. That server was left untouched. The complete Linux runs above used the
normal gate build and server lifecycle. An optional Linux repeat of the heavy spec exited 75 because the
browser gate held this worktree; the completed native heavy run is the reported reserve check.

`pnpm sync` fetched master and stopped while replaying the earlier toast work at a translation-catalog
golden conflict. The tested commit already contains the fetched master (`504ce3564`), verified with
`git merge-base --is-ancestor`. The rebase was aborted to preserve the tested tree and existing
goldens. Lint passed with zero errors and ten warnings in unchanged files; typecheck and formatting
passed.
