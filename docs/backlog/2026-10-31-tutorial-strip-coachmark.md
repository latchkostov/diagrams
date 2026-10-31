## Avoid an out-of-view hint for visible tutorial actions

The phone import lesson can show “Target out of view” while its Download practice file button is
visible in the tutorial strip. The coachmark's canvas clipping excludes a strip target. The action
is reachable and its instructions remain visible/scrollable; final UX review classified this as
nonblocking polish.

Prefer suppressing that spatial fallback for strip-owned actions, or anchoring an appropriate compact
hint without claiming that a visible action is offscreen. Cover the import Download and library Save
a copy actions on phone and keyboard layouts. Preserve the existing fallback for genuinely hidden
canvas targets; do not move the camera to reveal teaching chrome.
