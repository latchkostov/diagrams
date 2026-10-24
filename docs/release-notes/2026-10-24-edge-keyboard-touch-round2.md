## Edge shaping fixes

Touch segment targets now yield near reconnect dots, keeping the full reconnect hit area reachable.
Keyboard nudges keep the same leg selected when separate legs line up or endpoint routing adds or
removes detours. Selection geometry survives lazy control remounts, and pointer previews retain one
keyboard listener.

Regression coverage checks cumulative coordinates before testing merged nudge history, repeated
nudges across an endpoint escape, endpoint movement, and touch reconnects beside short port stubs.
All three P1 regressions fail on the reviewed revision, 563d20a5. No parity goldens changed; this fix
round runs only targeted specs, with full output parity left to PR CI.
