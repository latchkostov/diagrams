## Edge shaping review fixes

The existing contextual handles remain the only shaping controls; no chrome was added. Automatic
curves and direct lines show reconnect ends only, while orthogonal and saved routes remain editable.
Space panning takes pointer ownership through the interaction controller and handles yield their
pan-blocking hit targets. Each completed reshape is one undo step. Short jogs keep the same port
clearance in their preview and saved rendering. Ctrl/Command drags preserve their off-grid position.

Production Chromium coverage exercises selection, panning, cancellation, undo, snapping and SVG export.
The new regressions reproduce the reviewed failures on the original branch head.
