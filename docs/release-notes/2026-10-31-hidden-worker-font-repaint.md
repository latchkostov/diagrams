## Hidden particle canvases stay idle when fonts arrive

Finishing a font download no longer repaints the last worker canvas independently of Live's frame loop. At low zoom the hidden particle layer stays idle; returning to the natural drawing, or leaving a visible drawing paused, renders the fonts through the next eligible frame with the current view.

The original paint-count assertions remain enabled. Full output parity passes with all 3,178 goldens unchanged: zero changed, added, missing or stale. No golden is re-recorded for this scheduling fix.
