## Skill ZIP trim UX review

No controls, words, layout or interaction rules change. Quick-add placement and box selection already
return without acting in a read-only canvas, and the placement outline only renders for edit gestures.
Their viewer stubs retain the callback and ref shapes consumed by CanvasView. Connected quick-add
menus can only originate from editing gestures. The full editor continues importing the real modules.

Existing viewer and Interactive HTML browser specs cover rendering, saved routes, playback, pan/zoom,
read-only behavior, standalone files, password protection and network/storage isolation. Build tests
pin the four excluded modules in both viewer formats while retaining the canvas, simulation and saved
route renderer. No chrome or new example is needed for this payload-only change.
