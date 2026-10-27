## Toasts keep their Undo, Retry and late actions

- **Edit together:** a toast's Undo stays available while collaborators edit, and only ever reverses
  your own step it was offered for. A collaborator's change, or another step of yours, is never undone
  from it.
- **A failed toast download** offers Retry beside an open dialog (in its Tab order) and during an image
  export, where it takes the keyboard. Retrying brings back the waiting notifications, including the
  export's Cancel and the dialog's own confirmation.
- **Making a diagram private** offers Clear conversation even when its toast had to wait, behind a
  toast in use, a dialog or the toast download.
