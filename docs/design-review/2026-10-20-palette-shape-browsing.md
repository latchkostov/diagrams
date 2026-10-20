## Shape discovery without crowding

One Add shape… command discloses the existing searchable, categorised shape menu. No toolbar control or additional picker UI is added. Shape-name and alias searches still insert the chosen outline directly; browsing hides individual outlines even when recently used. Fit view and other core commands retain their relative order and the 60-result cap stays unchanged.

The menu opens at the canvas centre through the existing interaction controller, with keyboard focus and dismissal handled by the shared ContextMenu. A pick uses the standard annotation placement and undo path. The regression test covers opening, searching, picking and undoing; the unchanged locale-loading test guards mounted command labels.

Increasing the result cap and UI-specific filtering were rejected: both would leave browse discovery crowded and move catalogue policy into presentation code.
