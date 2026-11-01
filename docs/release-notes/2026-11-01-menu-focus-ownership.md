## Keep the keyboard inside an open menu

Opening quick-add or a canvas context menu now retires an earlier canvas focus move. Previously,
that move could finish after the menu opened and put focus back on its node, leaving the menu
visible but unable to receive typing or Enter. The canvas Tab stop stays selected, and Escape
still returns focus to the menu's invoker.

No export content or geometry changes. No parity golden is intentionally changed.
