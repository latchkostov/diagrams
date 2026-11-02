## Preserve the subject while reaching a field

Canvas Tab navigation intentionally moves selection with focus. An automation recipe reaching a
field in the current Inspector must account for that behavior: wrapping through the canvas can
replace the very fields it is navigating toward. Within that panel, use the direct document-order
route, with real Tab or Shift+Tab presses. Keep the existing global navigation for other surfaces.

The browser regression counts actual canvas focus entries in both directions. Reaching the target
alone is insufficient: the old driver could reach a same-named disclosure on the wrong selection.
The correction changes no product shortcut, Tab order, selection rule or chrome.
