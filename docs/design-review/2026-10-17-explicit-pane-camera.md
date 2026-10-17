## Pane camera UX review

The camera follows the action that changes the pane. A panel control can refit a fitted view; selecting or placing an item preserves its zoom and spot unless a minimal pan is needed to reveal it. Menus suspend that work, and an explicit Zoom to selection remains authoritative.

No controls or UI copy were added. Chrome budget and keyboard paths are unchanged. The regression coverage exercises pointer placement, right-click selection, menu dismissal, panel toggles and resizes, manual and narration ownership, and Shift+2. Earlier branch-only expectations for selection refits and discarded quick-add cancellation were corrected to the agreed rule; existing master assertions remain intact.
