## Commit before keyboard handoff

The round-1 capture release allowed shortcuts before the deferred reveal wrote the accepted name.
The placement path now declares naming to the editor-mode machine before measurement. On completion,
the interaction controller first commits the captured text and synchronously closes its creation
transaction, then releases capture and publishes completion. A late reveal neither rewrites the name
nor reopens its field. Cancellation ends the pending naming mode without affecting a newer target.

The same ordering applies after measurement hands the buffer to a still-downloading inspector.
The inspector supplies a document commit capability to its pending focus request, so Enter can save
the name and finish history without waiting for the field's code or focus. Committing may itself
mount that field; the controller prevents that render from replaying the accepted buffer.
The pending capture starts with any text already typed before measurement, preserving the whole
name and normal Backspace behavior across that handoff.
The focus request carries that prefix directly. Reading the document getter during the inspector's
layout effect can still see the old label before its parent's commit, so it cannot supply the buffer.

Existing Enter/Esc semantics, inspector fields and one-step creation undo remain unchanged. No
controls, chrome, text or lesson-driver waits are added. Rejected: delaying keyboard release until
measurement, releasing before committing, and letting the reveal replay an accepted edit. Each would
retain a timing dependency at the keyboard handoff.

## Regression evidence

The production-browser regressions fail with the round-1 placement implementation restored: held
measurement leaves the default label, and Enter/Undo/late reveal/Redo restores that default label.
The repaired tests check the full name and the next quick-add before delivering held work. A mounted
hook test uses the real history hook and fake timers to verify the transaction is already closed
when the next shortcut runs; the controller unit test checks commit, release and mode notification
order without scheduling a frame.

The first exploratory Linux load run found five unheld-case failures among 60 runs, exposing the
inspector handoff after the measurement-only correction. A controlled split-buffer case then caught
the stale getter returning the stencil label. Both failures were corrected in the implementation;
assertions, deadlines and existing tutorial and naming tests were retained.

## Verification

The seven targeted unit files pass all 325 tests. Removing the controller's pending-name commit
fails both new controller cases; removing the initial buffer fails the prefix/Backspace DOM case.
Restoring the round-1 placement path fails the held-measurement and Undo/Redo browser regressions.

Production Chromium passes `tutorials.spec.ts`, `text-fields.spec.ts`, `flow-building.spec.ts`,
`round13-polish.spec.ts`, `inline-edit.spec.ts` and `owner-decisions.spec.ts`: 282 passed, ten existing
quarantined cases skipped, zero failed or flaky. Cells then passes ten solution and ten Skip-all
repetitions with four workers. All five existing spec files remain unchanged.

Regeneration refreshes the bundled viewer and reports no i18n errors; existing translation warnings
remain. No parity golden is changed or re-recorded. No full gate or full suite is run in this fix round.

The final Linux run repeats each of the four browser regressions 20 times with four workers on two
CPUs: 80 passed, zero failed, zero flaky and zero skipped. The eight-worker request had exited busy
(75); the four-worker run fit the available shared budget. Intermediate runs were stopped when
revising the split-buffer case; only the completed final run is claimed here.

```text
SUMMARY: a60425d7de881b08e89c1dabf8bb0e1fbc9901c8 | unit="not run" parity="not run" e2e={"passed":80,"failed":0,"flaky":0,"skipped":0} gate_failures=0
```

Evidence: `tests/.output/g/rEdmKx5/e1/`, `tests/.output/naming-r2-existing-results.json`,
`tests/.output/naming-r2-cells-results.json` and `tests/.output/naming-r2-unit-final.log`.
Parity was not run in this scoped fix round.
