## Keyboard shaping after low-zoom selection (#378)

Clicking beside a connection at low zoom now gives the selected connection keyboard focus through the existing interaction policy. Arrow keys can immediately shape it. Pan, connect, reconnect and drag gestures retain their pointer input and focus.

The regression clicks four pixels off the line at 40% and 25%, then presses ArrowDown without manually focusing the edge. Removing the policy fix makes keyboard shaping fail. This change does not intentionally alter exported output or parity goldens.
