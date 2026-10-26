## Dialog feedback stays visible; toasts never cover menus or dialogs

A dialog's own outcome — "Share link copied.", "Couldn't copy automatically…", a refused clipboard
read — now shows beside that dialog and is announced, rather than being hidden behind it. It stays
clear of the dialog's buttons, takes part in its Tab order and closes with it.

Other notifications, such as an agent's change with Undo, step back while a dialog, the command
palette or another modal is open. They keep their place, are out of reach and don't expire. When
the modal closes, they return unchanged. Menus, including File ▸ Export as, now open above any
notification. Every fixed surface takes its stacking order from one scale in `tokens.css`.

An Undo raised where no canvas history is mounted keeps the earlier behaviour (it goes once anything
else undoes) instead of becoming unavailable.
