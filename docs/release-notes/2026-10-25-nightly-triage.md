## Nightly triage and bounded test fixes

Nightly's Vite dev server now enables the same test hooks as its production E2E build, so
collaboration tests use their emulated endpoint fixture and can inspect the shared Live run.
The planner-download test intercepts the actual `ui.ts` source module. The shortcut-dialog
test checks the exact macOS `⇧Tab` label and the Windows `Shift+Tab` label on every host.

The resource-invariant sweep retains 5,000 A1 and 5,000 A3 seeds and the ten-minute limit,
distributed across 16 smaller partitions instead of four. The
[triage inventory](../backlog/2026-10-25-nightly-triage.md) covers all 102 failed/cancelled jobs
across October 21–25 and preserves engine counterexample seeds for lane B.

Application behavior and all output goldens are unchanged. No golden is re-recorded.
The pool-field label assertion remains intact: the logged failure was an absent field,
with only one of three repetitions failing, rather than a renamed accessible label.
