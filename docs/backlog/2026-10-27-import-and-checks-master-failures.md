## Import visibility on clean master

The full Linux e2e run for readable node identity found two existing compose-import
failures in `tests/e2e/imports.spec.ts`: “Open… imports the compose fixture: nodes,
boundaries, connections and the toast” and “keyboard: focus stays in the report after
an action, and a name hands focus to its node”. The shared `expectShop` assertion
waits for every imported card to be visible, while the initial Focus frame culls
some of those cards. The first hidden node varies; the assertion and failure mode
are the same.

Reproduced only these cases twice on the exact tracked tree of clean origin/master
`c59c2127fd6e0403df02c117a3f204f30e9328d7`, exported with git archive into an isolated Linux directory with a fresh
frozen dependency install. No source overlays were applied. The pinned Playwright
image and Chromium project match the full run. Result:

`CLEAN MASTER IMPORTS SUMMARY: c59c2127fd6e0403df02c117a3f204f30e9328d7 | e2e={"passed":0,"failed":4,"flaky":0,"skipped":0}`

Evidence: `tests/.output/readable-master-imports.log` and
`tests/.output/readable-master-imports-results.json`. No import assertion or timeout
was changed. Follow up on the import camera/whole-diagram audit contract.

## Request Checks readiness on clean master

The same full run found missing verified-fix controls in
`tests/e2e/requests-wait-checks.spec.ts`: the English primary-fix/option-chips case,
and the inspector-alternative cases in Arabic and pseudo-English. Each was run
only twice on the same clean master snapshot above, with no source changes.
The same `check-fix-blocked-threads:caller` or
`inspector-check-fix-option-0-blocked-threads:caller` control was absent.

`CLEAN MASTER CHECKS SUMMARY: c59c2127fd6e0403df02c117a3f204f30e9328d7 | e2e={"passed":1,"failed":5,"flaky":0,"skipped":0}`

Evidence: `tests/.output/readable-master-checks.log` and
`tests/.output/readable-master-checks-results.json`. Keep the existing assertions
and timeouts. This confirms the baseline previously left open in
[Requests Checks count under Linux load](2026-10-24-requests-checks-count-under-load.md).
