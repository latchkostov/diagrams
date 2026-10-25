## Escape closes a command palette that is still loading

Opening Ctrl+K while an Inspector name field is still downloading now gives the pending palette
ownership of Escape immediately. Escape closes the palette before its code arrives. The earlier F2
naming request remains pending, and the Inspector label takes focus when its panel arrives.

Held-chunk regressions recognize both production assets and Vite development module URLs.
No diagram, simulation or export output changes are intended; no parity goldens were updated.
