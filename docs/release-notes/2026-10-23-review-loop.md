## Review loop: scoped rounds and distinct issues

Review round one now uses the PR's merge-base diff. Later rounds review first-parent fix commits and
merge resolutions limited to PR-touched files, with the exact file list printed at the top of the
report. Brief acceptance criteria and PR descriptions can accompany the review and persist across
rounds. Findings are consolidated across lenses with distinct severity counts and raw evidence kept.

P1 now requires a normal-use user-visible bug, data loss, privacy/security leak or regression.
Resource bounds need an untrusted entry point and superlinear or unbounded time/memory. Delta rounds
reassess open P1s and cap new findings on unchanged lines at P2. Round three produces a
quarantine-or-merge decision block; further rounds require an explicit owner-approved override.

Reviewer unit tests use explicit files through the one-worker quick gate. No application output is
intentionally changed; every parity golden must remain unchanged.
