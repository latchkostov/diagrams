## Toasts: collaborative Undo identity, download recovery and late actions (PR #340)

The last review round of PR #340 found three P1s at the edges of the lazy toast renderer and of
collaborative history. No controls, settings or chrome were added.

### Collaborative Undo names this person's step (R-71d8885e97)

In a room, the history's snapshot entry is only a baseline: every peer's edit replaces it. An Undo
toast bound to it went stale on any peer's edit, although Ctrl+Z would still reverse the same step.
The toast now binds to the room's local undo-stack item (`EditorRoom.undoEntryId`, an identity kept in
the Yjs stack item's meta). Peers' edits never enter that stack. A merged local edit extends the same
item. Undo and Redo carry the identity to the step they make, so a redone step is the same step
again. Another local step is a new item: the toast goes stale and never reverses it.

### The renderer's Retry under modals and tasks (R-c5ec030031)

The bootstrap Retry shown when the toast chunk fails to download ships outside that chunk, and now
follows the layer rules (`2026-10-25-toast-layering.md`):

- with a dialog open, it renders in that dialog's feedback slot: beside the panel, in its Tab cycle,
  announced inside `aria-modal`. In a short window it goes inside the panel with the panel's height
  kept, as the Toaster places feedback. Pressing it gives the keyboard to the dialog panel, so Tab and
  Escape keep working while the download restarts;
- otherwise it is on the page layer, stepping back (hidden, inert) under a modal without a slot;
- it is a toast (`data-toast`), so a task holding the page's input (an image export) lets it through.
  It takes the keyboard there, as the task's own Cancel would have, which is still waiting to show.

After Retry, the queued notifications replay in order: the dialog's feedback arrives beside it, and
the export's progress and Cancel arrive with the keyboard.

### A late action reaches its notification by id (R-fdfddab3b5)

"Clear conversation" is found after the "now private" toast shows, once its chunk loads. It was
offered only if that toast was the one showing. A toast that waited (behind a toast in use, a
dialog, or the renderer download) lost it. `toast.attach(id, action)` now adds an action to a live
notification wherever it is: shown, retained, waiting, a task's, or a dialog's feedback. It does
nothing once the notification has gone, and never replaces an action it already has. Its expiry is
the one for a notification with an action.

### P2s

- R-72cb0c8ed6: a fake-clock hook test covers capture's merge tag, which lasts only for the debounce.
- R-50342866c4: while the renderer is unavailable, consecutive invalidations collapse into one,
  unless a notification came between. Pending is no change. Two different entries invalidate as a
  fresh one does. Progress replaces its own queued report. Releasing dismissed notifications before
  the renderer loads stays in `docs/backlog/2026-10-27-toast-review-followups.md`.

### Validation

Each P1 and P2 has a regression test that fails with its fix reverted (mutation-checked). The
hold-the-chunk tests in `tests/e2e/toast-loading.spec.ts` cover Retry inside Share (keyboard),
in a short window (placement, pointer), and during an image export (input held, keyboard, then
Cancel). `tests/e2e/privacy-audit.spec.ts` covers the private toast waiting behind a toast in use.
