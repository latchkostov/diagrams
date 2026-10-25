## PR #320 focus ownership fix review

Keyboard activation keeps the pinned card ready for arrow navigation, including when
pinning replaces its focused section button. A backward Tab from a loading stop gives
focus back to the node; late details respect that choice. Menus, Escape and traversal
to another node retain their cancellation behavior.

No controls, copy, placement or visual styles change. Browser regressions cover node
and edge summaries and the held-download return to the opener. The machine tests cover
ownership paths, cancellation, guarded claims and single transfers.
