## PR 340 fix round: retained Undo correctness and release

The retained toast keeps its geometry and keyboard focus. A stale Undo remains in place with
`aria-disabled` and an accessible description explaining that the diagram changed; the polite status
region announces that explanation. Both the DOM activation boundary and the stored callback guard
against reversing another history entry. No new chrome or settings are needed.

Rejected using the merge tag or stack index as identity: tags can be reused and a new branch can occupy
the same index. Opaque entry IDs distinguish those steps while preserving identity through a system
copy-name assignment. Route-reset feedback is emitted after all layout and boundary edits, so capturing
its entry does not split the operation's Undo step.

Regressions exercise real agent edits with hover and keyboard retention. Independent press tests move
the pointer and focus away before delivering a notification and moving the bar. Separate pointer-leave
and Tab-away tests release without activating or dismissing, checking queued notifications, placement
and resumed expiry with the controlled clock.
