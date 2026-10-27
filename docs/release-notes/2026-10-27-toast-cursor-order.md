## Restore canvas cursors after lazy toast bundling

Nodes again show the move cursor and the editing pane shows the default cursor in Linux production
builds. Commit `00d063c5` grouped app styles into the startup runtime before React Flow's stylesheet,
letting its equal-specificity cursor rules win. The runtime group now accepts scripts only, preserving
the original stylesheet order without changing selector specificity or bundle budgets.

A held-toast download regression checks node, palette tile, category, search and pane cursors before
the notification, while its renderer is held, and after release. No parity goldens are changed.
