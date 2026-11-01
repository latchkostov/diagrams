## A late canvas move takes focus back from quick-add

Nightly 41313411980 at ae1c07db3622a6479582e66ecd37c55ddd27ea40 fails the macOS study-cells
keyboard recipe inside the exact menu-focus wait. Its screenshot has connected quick-add open
while focus remains on the canvas node. The wait exposes a product ownership problem rather
than providing a reason to send another key behind the menu.

A deterministic interaction-controller regression opens each canvas menu while a measured node
focus move is pending, lets the menu take focus, and drains the frame/commit queues. All three
cases fail before the repair: focus lands back on the node. Opening a canvas menu now retires
that earlier move. Its scheduled frame is cancelled by the existing controller retirement path.
The tests retain the roving node and verify Escape still restores its invoker. Dialog and Live
popover ownership, camera readiness and keyboard edge navigation are unchanged.

The focus-policy state/event invariant now requires retirement for the three self-focusing
canvas menu kinds, while retaining the previous pending move for Live popovers and dialogs.
There is no sleep, timeout, tolerance, retry, skip, quarantine or budget change. Temporary
reversion and final local/dispatched results are recorded in the round-seven verification.
