## Naming hands the keyboard back cleanly after Enter

Enter commits a new node's entire buffered name and closes its creation transaction before releasing
keyboard ownership. An immediate Alt+Right grows the flow from that committed node, even while its
measurement or reveal frame is pending. Focus then waits for the named node to become visible and
focusable; opening another menu or moving focus supersedes that request.

The same ordering covers a name whose inspector is still loading, including a prefix typed during
placement. Pending inspector Escape still saves the typed name; pending placement Escape retains
the stencil label, as before. A late reveal cannot reopen a completed name or overwrite Undo/Redo.

No parity golden is changed or re-recorded. This scoped fix round did not run output parity.
