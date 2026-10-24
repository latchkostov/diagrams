## Slow-motion lifecycle pilot

Reviewed against UX principles: no controls, labels, toolbar rows or shortcut meanings change.
Capture still freezes Live, replay starts at 1×, a paused take holds its camera, and Escape restores
the entry viewport and prior Live speed. Menus, dialogs, recording and editable fields keep their keys.

Lifecycle commands now claim the camera and request a take synchronously. React subscribes to a
snapshot instead of deciding ownership after rendering, so a short capture cannot disappear between
effects. Replay geometry travels with the existing replay download; the existing loading, cancellation
and retry surfaces continue to cover that download. Browser readiness exposes the machine phase only
in development and E2E builds, with no additional product chrome.
