## Windows gate checkpoint readers can block atomic replacement

The PR #179 full gate reported two non-test reporter errors while its live checkpoint was read
from PowerShell: `writeCheckpoint()` could not rename `checkpoint.json.tmp` over `checkpoint.json`
(`EPERM`). The final Playwright JSON report remained readable and complete.

This is unchanged on origin/master `3d6f477ddc1869b286285308cba8552dad9c9f48`.
An untouched export of that commit reproduced the same `EPERM` twice by holding a checkpoint open
with .NET `FileShare.ReadWrite` (without delete sharing), then invoking its exported
`writeCheckpoint()` function. No full master gate was rerun.

Follow up on reader sharing or checkpoint replacement so observing progress cannot fail a gate.
Until then, monitor the step log rather than opening the live checkpoint on Windows.
