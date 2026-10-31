## Keyboard tutorial focus acknowledgement

The driver accepted any focused ancestor containing the requested node, including
the entire canvas. It could then send connection navigation before the node took
the keyboard. Node and edge acknowledgement now requires the focused item's own
identity. A finished lesson also ends command navigation before another palette
action can run.

The held-focus regression fails without the fix: the driver returns while focus
is still held at the canvas. The finished-lesson regression also fails without its
guard because the command resolves normally. Both retain real keyboard navigation
and the original lesson completion predicates; no new exception or skip is added.

Circuit-breaker additionally completes while a connection-navigation key is in
flight. Its completed handoff owns focus, so an item-id change can no longer
acknowledge that key. The driver observes completion alongside focus and yields
to the finished lesson. A real-key regression finishes the lesson during that
keypress and fails without this guard.
