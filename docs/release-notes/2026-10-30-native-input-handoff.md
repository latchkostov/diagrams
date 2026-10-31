## Keyboard input survives loading

The stencil library remembers Enter pressed while its contents download, adding the requested stencil once the search is ready. Quick-add keeps navigation and the pick ahead of subsequent naming input while search metadata loads. Escape saves a typed name even when its field has not mounted yet, matching the existing text-editing contract.

Held-chunk browser regressions cover the library and both quick-add completion paths. No output goldens are intentionally changed.
