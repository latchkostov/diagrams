## Line editing review fixes (#248)

Click-to-connect now uses the interaction controller for mouse and accessibility activation. Cancelling a connection retires React Flow's document listeners and auto-pan frame, so Escape or losing window focus leaves no pending connection or undo step. Pointer previews no longer change the canvas shell's menu/focus snapshot, and reconnect previews subscribe by edge ID.

The cold inspector regression now holds both development modules and production chunks. Regression tests cover click activation, cancellation and recovery, stopped auto-pan, and stable snapshots across 100 pointer moves. Output parity: no goldens are changed by these fixes; none were re-recorded.
