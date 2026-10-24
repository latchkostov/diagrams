## Searchable menus load through the interaction controller

Menu rows, search and picking now download on first use. The interaction controller keeps ordered
input through the same pending-input path as held renames. A queued pick transfers subsequent typing
to the new node's name; Escape finishes that name. Moving to another control or clicking away cancels
the pending menu without taking that control's Enter. Failed downloads offer Retry in the menu.

The node inspector's naming and stencil-picker container also loads on selection. Placement passes
its captured text to the inspector's pending rename, so a delayed field cannot overwrite the first
characters. Pending new-node names save each edit immediately, as mounted name fields do, and
Enter or Escape returns focus to the new node without waiting for its inspector. Read-only exports
exclude editing menus, retaining the existing skill ZIP limit. Held-download browser tests compare these paths with an already loaded menu, including
navigation, later edits, naming, cancellation and independently delayed inspector fields.

Canvas first view decreases from 380,961 to 374,563 gzip bytes, restoring 8,437 bytes of headroom
against the unchanged 383,000-byte budget. Entry is 107,972 bytes, startup is 173,493 bytes, and the
additional Live download is 126,245 bytes. Startup remains below its warning floor and needs a separate
trim. Naming callbacks depend on stable history methods, so unrelated nodes retain their render
memoization during selection and typing. No parity goldens change; diagram, simulation, planning, layout and export output stay unchanged.
