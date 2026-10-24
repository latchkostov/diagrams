## Inspector review fixes UX review (#265)

Reselecting a checked segment keeps its settings and history unchanged, matching the radio affordance. Arrow navigation still changes choices and moves focus; Home and End keep focus even when the selection is unchanged. No controls or chrome were added.

Shared disclosure bodies use independent layout defaults, with existing Inspector spacing retained through scoped overrides. The retry regression checks that a custom jitter choice remains selected and that both converted controls preserve sibling settings through Undo.
