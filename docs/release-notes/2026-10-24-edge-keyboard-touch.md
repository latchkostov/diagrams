## Keyboard and touch line shaping

Select a line with Ctrl+Alt+] / [, then use [ / ] to choose a segment. The active segment gets a focus ring while the line keeps keyboard focus. Arrow keys move it across its direction onto the next grid line; Shift moves 50 px. With Snapping off, those steps are 1 px and 10 px. Consecutive nudges share one Undo step. Moving an end adds a jog; aligning neighbouring segments removes bends.

Screen readers hear the segment's number, direction and movement guidance, each move, and a return to automatic routing. Repeated identical announcements replace the live region's content so each move can be heard. The shortcuts sheet lists the new keys without adding canvas controls or Tab stops.

Touch handles use 44 px hit areas on coarse pointers and prevent browser touch panning while held. A normal release commits once; pointer cancellation restores the saved line without adding history. Connection dots use a larger touch halo.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: nine English messages add six `edge.shape.*` announcements and three `shortcuts.segment*` hints. Catalog message/fallback counts and the `edge`/`shortcuts` area hashes change accordingly, including the generated pseudo-locale. Drawing, selection, export and other message goldens stay unchanged. Other languages use the existing English fallback.

Shaping geometry and keyboard handling stay in the existing lazy `edge.shaping` surface. Unused diagnostic shortcut labels were removed from the eager binding table; translated display labels remain in the lazy sheet. Live bend carry preview and interop/agent changes remain deferred to their approved work.
