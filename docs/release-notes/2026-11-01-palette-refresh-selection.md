## Keep the chosen command during a refresh

The command palette now keeps the highlighted command when the canvas or live session republishes
its context. Previously that publication reset the highlight to the first result, so Enter could
run a different command after arrow-key navigation. Changing the search or entering a submenu
still highlights its best match; a command that disappears falls back to the first result.

No parity golden is intentionally changed.
