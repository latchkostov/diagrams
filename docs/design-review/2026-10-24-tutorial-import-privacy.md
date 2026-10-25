## Tutorial import and library consistency

Tutorials use the same persistence and privacy policy as the main app. An imported document opens as a
normal editable document, and a failed write leaves the tutorial in place. New diagram names the blank
draft explicitly. Client-side navigation preserves device destinations and the fresh draft identity.

Deletion Undo uses the existing recovery row inside Your diagrams, where the dialog's focus trap keeps
it reachable. Successful recovery removes that row; failed recovery retains it with the storage error.
No new controls or chrome are added. Fault demos wait for the normal enabled Live action; Restart exits
slow motion through its controller and waits for simulation switching to become available.
