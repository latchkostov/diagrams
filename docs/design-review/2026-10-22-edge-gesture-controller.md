## Edge gestures in the interaction controller

Designer source review found no blocking UX issues. Reconnecting keeps its existing end handles,
crosshair, whole-node target glow and dashed preview. Connecting keeps its existing quick-add preview.
There is no new chrome or UI copy. Escape cancels before canvas shortcuts act; normal endings preserve
focus, remote deletion recovers only lost focus, and inspector pane work waits for the gesture.

The existing D8 browser cases remain unchanged. The additional journal regression checks Escape and
release without a commit. Browser verification is recorded with the PR; this review itself is source-based.

Reconnect handles and the edge inspector now load on selection, using the existing lazy-loading helper.
The first view still loads the same two canvas chunks. Bundle budgets and chunk assertions are unchanged;
new assertions keep these selection-only surfaces out of the first view. Field readiness continues through
the interaction controller.

The follow-up review rejected partially registering legacy node drags: reporting Escape cancellation
while React Flow could still commit the move would change behavior. PR 1a therefore reserves the pure
node.drag types and leaves its DOM migration to PR 4, with real cancellation and the carry preview.

The load run exposed an annotation connection test measuring after the Inspector's collapsed flag,
before the pane and camera had necessarily settled. It now waits for the pane, camera and handle
geometry before measuring. All original preview, endpoint and persistence assertions remain.
