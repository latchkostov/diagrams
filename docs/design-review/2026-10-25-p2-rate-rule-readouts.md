## Rate limit and readout follow-ups

The Rate limit field remains in Simulation in the existing Inspector, with no new toolbar or menu controls.
Its units and clearing instructions are visible without hovering and linked as the accessible description.
At the quota ceiling, the disabled field explains the required action beside it. Bulk editing disables
adding a local rate when any selected API has no room, preserving each API's budgets.

Repeated edits retain the same local quota and leave unrelated quotas in order. Existing quota edits and
clearing remain available at the ceiling. Live coverage checks that traffic continues and downstream counts
respond to the edited rate, including Undo and removal.

Rule identity and planning safeguards add no chrome. Hover placement still reacts to protected controls
appearing, disappearing, resizing or hiding, while animated waiting meters do not trigger a full rescan.

Rejected: dropping an unrelated quota to make room, editing whichever quota became first after a render,
changing authored IDs during ordinary reads, and raising bundle or skill ZIP budgets. Each would compromise
the existing behavior or hide the underlying defect.
