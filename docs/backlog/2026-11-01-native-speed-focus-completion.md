## Completion can land between two native-control focus checks

Implementation CI 41310436389 fails the circuit-breaker keyboard lesson at native-select.ts:15.
Its trace has completed the lesson and opened the real handoff sheet, which takes focus, while
the driver still waits for the optional speed select to be focused. The previous completed-speed
repair only handles a value restored after selection; it does not cover this earlier handoff.

Only the affected keyboard-third spec is checked once on clean origin/master, twice in Linux:
twenty executions pass. An identical pre-existing failure is not established. A new held handoff
regression then finishes the lesson between the driver's focused snapshot and the native
selection's check. The old helper fails; the repaired helper yields CompletedStep, sends no key
to the handoff sheet and keeps the untouched select's value.

Native selection now accepts an optional owner-completion predicate. It observes exact focus and
popup states while selection is needed, checks completion before trusted keys, and returns when
that owner has finished. Only the tutorial's optional live-speed choice supplies the predicate,
and only the runner's actual finished state qualifies. Required selections and their exact value
assertions remain. No focus is moved programmatically by the driver, and no timer, tolerance,
deadline, budget or retry changes.

Both speed-completion regressions pass three Windows production repetitions. Restoring the old
native helper fails the new regression again. Linux and dispatched Native results are recorded
in the round-seven verification fragment. This follow-up is signed and pushed separately.
