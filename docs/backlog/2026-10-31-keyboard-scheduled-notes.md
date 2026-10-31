## Scheduled simulation notes

The Windows keyboard Webhooks run reached the 6.5-second note only as the wall-clock visibility deadline expired. The driver now installs the browser clock before navigation and advances simulation time until the actual Continue control is visible. It still uses real keys to focus and activate that control; no predicate, timeout, or simulation value changes.

The Webhooks solution and a paused-clock regression both pass. Temporarily restoring the former visibility-only wait makes the paused-clock regression fail because simulated time cannot advance. No golden changes are expected.
