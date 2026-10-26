## Toasts beside dialogs, never behind or over them

A notification raised while a dialog is open now shows beside that dialog and is announced. This
covers the dialog's own outcome ("Share link copied.", "Couldn't copy automatically…", a refused
paste, "Duplicated · Open") and anything else that happens meanwhile, such as an agent's change or a
download that needs Retry. It stays clear of the dialog's buttons and takes part in its Tab order.
If it is still showing when the dialog closes, it stays on the page.

Notifications from before a modal (a dialog, the command palette, the shortcuts sheet) step back
while it is open. They keep their place, are out of reach and don't expire, then return. Menus,
including File ▸ Export as, now open above any notification. Every fixed surface takes its stacking
order from one scale in `tokens.css`.

An Undo whose edit was still settling (a text that grew, then moved clear of an edge) is no longer
marked unavailable. Where no canvas history is mounted, Undo keeps the earlier behaviour (it goes
once anything else undoes) instead of becoming unavailable.
