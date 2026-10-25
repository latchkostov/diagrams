## Resilience reselection and Undo

The shared caller-policy setter ignores unchanged normalized values and tags retry and breaker edits consistently.
Retry, breaker and deadline tuning survives reselection without an extra document write. Undo restores a
short retry/breaker tuning sequence together even if history flushes between fields; Redo restores the tuning.
Separately flushed timeout edits retain independent Undo steps.

No controls, text or layout were added. Existing new-policy defaults and explicit Off overrides remain intact.
Unit coverage includes every retry and breaker tuning field, deadlines, empty policies and flushed history.
