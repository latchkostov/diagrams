## Line editing review fixes (#248)

Click-to-connect now uses the interaction controller for mouse and accessibility activation. Cancelling a connection retires React Flow's document listeners and auto-pan frame, so Escape or losing window focus leaves no pending connection or undo step. Pointer previews no longer change the canvas shell's menu/focus snapshot, and reconnect previews subscribe by edge ID.

The cold inspector regression now holds both development modules and production chunks. Regression tests cover click activation, cancellation and recovery, stopped auto-pan, and stable snapshots across 100 pointer moves. Output parity: no goldens are changed by these fixes; none were re-recorded.

## Renames typed while the inspector downloads (#248)

The first rename of a connection or boundary no longer loses keys while its inspector panel downloads. The interaction controller holds what's typed for the requested name field (a pending rename), so T no longer adds a text and Backspace no longer deletes the connection; the text lands in the field once it takes focus, with the caret after it. Enter or Esc typed meanwhile finishes and saves the name when the field arrives (Esc before any typing cancels); a press, or focus moving out of the canvas, ends the rename and its held keys. If the panel's download fails, the rename ends at once, keys reach the canvas again before any Retry, and the existing toast offers Retry; Retry's code ships with the app, not the panel. A failed Live issue-detection download is now announced through Live's trouble announcement region, which is mounted empty first.

Browser regressions hold the edge inspector's chunk through a rename and fail it mid-rename, and interrupt a reconnect with a native pointercancel and with a lost pointer capture. Output parity: no goldens changed.
