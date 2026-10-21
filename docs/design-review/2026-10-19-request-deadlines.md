## Deadline UX review

Timeout lives beside While waiting in the Request connection's Simulation disclosure. Messages and
historical revisions gain no control. Clearing the field means no deadline; integer milliseconds
and format bounds are checked before persistence. The hint explains failure propagation and that
downstream work continues.

The existing connection pill gives timeout counts priority, using a cross glyph and danger text.
Placement reuses the shared spatial index and reserves node readouts, labels and other pills.
The hover retains timeout and late-reply counts after calls finish. No global control is added.

The exhausted-thread callout has one action: Add a timeout for an unbounded stalled/down/cut call,
otherwise Free the thread while waiting. Busy-thread scaling remains deferred to PR 4. The fix uses
the effective policy editor, preserves saved simulation overrides and is one Undo step. Drafts and
slow motion retain their existing protection. Loop exhaustion explains how a timeout breaks a wait.

Production browser coverage checks the field, pill, hover, fix/Undo, both example runs and a timeout
edit during Watch together. Existing simultaneous-pill placement and waiting controls stay covered.
The example uses the approved settings; its queue saturates within ten seconds, with gateway 504s
later than the design estimate. Altering traffic or fault magnitude to manufacture the estimate was
rejected because it would change the approved lesson.
