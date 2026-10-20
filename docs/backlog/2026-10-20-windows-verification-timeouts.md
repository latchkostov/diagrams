## Windows verification under concurrent load

During the annotation palette follow-up, the full Windows unit run reported 12,875 passed, nine failed and four skipped, plus an unhandled gate-budget cleanup error. Six failures were existing test hang backstops: blocking-call evidence, three gate-budget cases, a local-gate case and a sync case. Markdown fuzzing hit its separate hang backstop. Two skill export assertions observed the viewer being regenerated concurrently; both passed after regeneration finished.

Focused follow-ups passed every affected file: the skill/gate/sync/examples subset had 449 passed and one blocking-call timeout; the subsequent examples/Markdown subset had 121 passed. No assertion or timeout was changed. Avoid overlapping regeneration and tests that read its output.

An isolated archive of origin/master `5dfc39bf42442ab5fe62c8043fbd8aa3d07368ee` was checked with two repeats of the affected specs. The blocking-call test passed; gate-budget and local-gate passed; sync had a different existing five-second timeout ("sync preserves both sides of authored conflicts"). Thus the original failures are not all established as identically reproducible on master. Investigate test hang backstops and late cleanup on a less contended runner if CI repeats them.

The final three-repeat production palette/i18n run had 335 passed and one gallery palette-opening timeout; all three locale-refresh and new shape-picker cases passed. The gallery case then passed three focused repeats, and passed two repeats against clean origin/master. Its cause remains unconfirmed; keep the assertions intact.

The required Linux load run could not acquire the shared worker budget and exited 75. Run palette-command, annotations, drawing-basics, round4-polish, viewport, platform and inspector five times under Linux load in CI or when capacity is available. No live reservation was modified.
