## Phone overflow and zoom integration

Correct the lazy phone overflow regression test's mode assumption: Live cards select with a pointer
cursor; Edit cards retain their move cursor. The zoom branch's editing-gesture gate correctly makes
Live nodes non-draggable and their dots non-connectable. CI expected `move` but received `pointer` on
`node-shopper`; containment and transport geometry were not the cause.

Coverage now also drags a visible Live card while overflow is pending, requires camera movement with
an unchanged diagram, and checks that dot clicks cannot enter a connection gesture. Existing exact
transport bounds, focus, exports, playback and Retry checks remain, with cursor checks after recovery.
Keep the gate and containment: restoring draggable Live nodes or adding a misleading move cursor
would hide the test's incorrect assumption. No application output or parity golden changes.
