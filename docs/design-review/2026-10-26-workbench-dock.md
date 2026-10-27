## Dock review

One column avoids the previous Properties-plus-AI width cost. Checks is a tab rather
than floating over the diagram. A state machine records the active and previous
tabs; a separate mount callback hosts the existing lazy AI panel without moving
WebMCP ownership out of the application shell.

## Review findings addressed

Warning badge ink now passes AA on amber in both themes, guarded against the CSS
actually used. A closed dock's replacement toggle gets focus through the interaction
controller. Tab arrows, Home, End and Escape retain their explicit targets.

Selection settling includes the selected ids, not only whether selection is empty:
reopening a closed dock after selecting another item waits for pointer-up too.
Existing simulation-authoring panels retain their own narrow-screen arbitration;
the rail stacks above their canvas column so AI remains reachable.

## Validation limits

The first browser run exposed outdated floating-card and annotation-column flows,
and real AI lifecycle/stacking issues. Those are fixed before the follow-up run.
The shared worker budget can prevent admission; busy attempts are reported, never
worked around by deleting locks or increasing test timeouts.
