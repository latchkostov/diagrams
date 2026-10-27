## Toasts load on first use

The canvas first view falls from **377,784 B to 373,802 B gzip**, leaving **1,006 B** below the unchanged
374,808 B reserve limit. Toast rendering and interaction code now download with the first notification;
notification ids, Undo ownership and pending operations are captured immediately. A failed download offers
Retry without losing the notification. Dialog feedback, focus return and export keep their existing behavior.

The same six startup chunks remain pinned. Budgets and reserves are unchanged. No parity goldens were
changed by this trim. The generated skill viewer is refreshed with the refactored notification code.
