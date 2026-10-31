## Wait for background verification before testing keyboard fixes

Nightly 41190929111, Windows shard 3, fails the initial verified primary-fix assertion in all three locales and the inspector alternative in Arabic. Each missing-fix snapshot still shows the genuine background check in flight: the Checks card says Checking, and its warning count is zero. Opening the dock is not a completed verification signal.

The primary-fix fixture now uses the existing `waitForBackgroundChecks` helper before opening Checks by keyboard; the imported inspector fixture waits on the same real scheduler/worker completion. Findings, fix values, focus, keyboard and Undo assertions are unchanged. The asynchronous preparation retains the existing whole-test hang backstop, and rendered assertions retain their normal deadlines. No timeout or CPU budget changes.

A regression holds a real checks-worker result, keeps the canvas keyboard-usable, and proves the keyboard fixture cannot open Checks before that result is published. Releasing the original response enables the original primary fix. The measurement observer preserves both native transfer overloads and never synthesizes a result.

The separate clean-master renderer check in this same worktree passed both repetitions: **36 passed**, eight workers/four container CPUs, commit e74b219a8. That does not establish an exception for the additional loaded CPU-ratio failures, which remain enabled and unresolved; no second master reproduction is queued.
