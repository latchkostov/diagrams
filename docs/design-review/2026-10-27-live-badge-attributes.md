## Fix-round UX review

Badge readouts, playback, layout and controls retain their existing behavior across Live and viewers.
The change moves attribute construction into Live without adding a loading boundary or UI text.

## Decisions

Keep production readouts and memoized badges. Reject E2E-only attributes, increased bundle budgets
and weaker assertions: viewers need the readouts and the shell must retain its existing headroom.
