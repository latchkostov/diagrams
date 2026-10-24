## Deferred searchable menu: interaction-controller input handover

PR #272 quarantines searchable-menu deferral after two replay fixes still changed keyboard behavior.
Keep the menu eager until a deferred implementation can replay through the interaction controller's
pending-input path, with explicit ownership transfer from menu search to the selected action's naming
capture. Do not add another local DOM-event replay queue in ContextMenu or MenuList.

Cover ordered search edits and navigation, Escape after Enter picks a node (finishing its name rather
than cancelling the queued pick), Enter-pick itself, and all subsequent typing handed over to naming.
Compare eager and held-download behavior, including failed download, Retry, cancellation, focus in
another control and inspector fields arriving later. Input must be consumed exactly once and remain
ordered across the ownership transition.

The quarantine also restores master's eager naming container and lazy identity fields: the deferred
container lost post-pick naming characters in targeted tests while clean master passed twice.
Future container deferral must cover the same pending-input ownership transition. The remaining
PR #272 trims and bundle limits stay unchanged. Production canvas first view is 380,961 B gzip,
leaving 2,039 B against 383,000 B: below the 8,192 B warning floor but in budget.

## Trim 3 follow-up

The searchable menu remains eager. A native input preserves IME, paste, selection and modified
editing keys, but adoption also needs a proved transition across queued Enter: later input can belong
to naming, while a no-match Enter or a submenu keeps menu ownership. Search edits after navigation
also reset the active result. Final input state alone cannot reconstruct these intermediate ownership
and highlight transitions. No new keyboard replay or menu deferral was landed; draft #273 stays open.
The separate settings split keeps the existing eager naming container.
