## Searchable menus load through the interaction controller

Menu rows, search and picking now download on first use. The interaction controller keeps ordered
input through the same pending-input path as held renames. A queued pick transfers subsequent typing
to the new node's name; Escape finishes that name. Moving to another control or clicking away cancels
the pending menu without taking that control's Enter. Failed downloads offer Retry in the menu.

The node inspector's naming and stencil-picker container also loads on selection. Placement passes
its captured text to the inspector's pending rename, so a delayed field cannot overwrite the first
characters. Held-download browser tests compare these paths with an already loaded menu, including
navigation, later edits, naming, cancellation and independently delayed inspector fields.

Canvas first view decreases from 380,961 to 374,379 gzip bytes, restoring 8,621 bytes of headroom
against the unchanged 383,000-byte budget. Entry is 107,953 bytes, startup is 173,474 bytes, and the
additional Live download is 126,252 bytes. Startup remains below its warning floor and needs a separate
trim. No parity goldens change; diagram, simulation, planning, layout and export output stay unchanged.
