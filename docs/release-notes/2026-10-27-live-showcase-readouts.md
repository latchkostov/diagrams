## Live showcase readouts after navigation

Live readouts now become visible when a camera animation finishes. Navigating to a
service previously left its badges hidden until four additional animation frames,
even after the camera reported idle. This broke showcase navigation on a paused
clock; selection and simulation counters themselves were already working.

Live clicks still select services and open their readouts without starting a
connection or editing the diagram. Edit-only connection and movement gates remain
in place, preserving the previous Live fit fix. No output goldens changed.
