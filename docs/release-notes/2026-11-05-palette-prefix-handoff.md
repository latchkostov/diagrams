## Preserve command search through focus handoff

Ctrl+K keeps letters typed while the command palette's search is waiting to
take focus. The input capture now stays active through the passive focus setup,
after the loading dialog restores keyboard ownership. Previously it could stop
in layout, leaving a gap that dropped the beginning of a command query.

The regression supplies `diagra` during that handoff, finishes `diagram
properties` in the focused search, and verifies that Enter runs the complete
command. Restoring the earlier handoff phase loses the prefix and fails the
test. Existing retry-upgrade assertions and timeouts remain unchanged.
