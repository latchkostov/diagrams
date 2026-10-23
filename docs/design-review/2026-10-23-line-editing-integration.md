## Line-editing integration review

The master merge keeps pending inspector renames and the hovered-card Enter rule
together: typing waits for the requested inspector field, while Enter pins a card
opened by the pointer over unrelated chrome. Reconnect and fixed-dot gestures keep
their existing cancellation, focus and undo contracts. This integration adds no
controls, vocabulary or production interaction behavior.

## Export verification readiness

The connect-to-dot five-repeat Linux run had 1,349 passes and one failure in the
persistent Retry test. Its trace showed an export-success toast arriving after
the test had already advanced the paused clock past toast expiry. The diagram
download and the separately downloaded confirmation words are distinct completion
points. The same spec passed both targeted repetitions on clean master, so that
browser failure was not claimed as an established baseline failure.

The export helper now waits for the published success toast before callers advance
the clock. The existing zero-toast assertion stays intact. A new regression holds
the confirmation chunk, observes the file download, opens and closes the File menu
to prove the app stays usable, and checks that export readiness is still pending.
Temporarily removing the readiness wait made this regression fail with completion
already true. Restoring it is checked with five Linux repetitions of the affected
spec at six workers and six CPUs.

## Output and remaining baseline failures

Both branches retain the canvas and skill download budgets without increases.
The merge parity checks covered 3,111 goldens with none changed; this follow-up
changes only tests and review documentation. No product output is re-recorded.
The separate native unit timeout evidence is recorded in
[the backlog fragment](../backlog/2026-10-23-line-editing-master-unit-timeouts.md).
