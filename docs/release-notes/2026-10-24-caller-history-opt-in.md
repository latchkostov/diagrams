## Separate Undo steps for resilience edits

Retry and circuit breaker tuning now preserve separate Undo steps after history flushes, as before
PR #298. Caller-policy history merging is opt-in through explicit edit options; menus and Apply fix
commands do not inherit a shared inspector tag. Reselecting unchanged normalized values still writes
nothing and preserves Undo and Redo.

This supersedes the round-one note's claim that separate retry and breaker edits should undo together.
HLC-27 now checks both intermediate Undo and Redo states as well as retaining all reselection checks.
No parity goldens changed; this fix round runs only the requested targeted tests.
