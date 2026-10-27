## Undo stays attached to its change

An engaged notification keeps its place when another edit arrives, but its Undo now becomes inert if
history has moved on. The button keeps keyboard focus and announces “Undo unavailable: the diagram
changed.” Activating it checks its original history entry again, so an older agent notification cannot
undo a newer change. History entry IDs survive autosave's system-assigned copy names and do not depend
on reusable merge tags. Route and traffic-mix removal notifications use the same binding.

No parity goldens changed. This fix round runs the toast unit tests and routing, recording and toast
browser specs; full output parity remains with CI under the requested targeted-only verification.
