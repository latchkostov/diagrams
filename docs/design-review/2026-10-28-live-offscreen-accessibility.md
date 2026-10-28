## Accessible values

Virtual-cursor reading must work independently of focus and camera position. Off-screen visual
ink is hidden from assistive technology while a visually hidden, named group and meter carry current
counters, status and thread-meter values. Returning cards and whole-diagram capture restore the
current visual readout synchronously and remove the semantic mirror, avoiding duplicate readings.
Unknown or removed thread capacity clears numeric meter attributes.

## Interaction and chrome

Named groups carry the summary through ARIA attributes so updates do not lay out hidden text.
No controls, camera changes or keyboard stops are added. The normal on-screen badge keeps its
existing presentation. The update path reads no geometry or computed styles and diffs its writes.
Regression coverage keeps the viewport and focus stationary while the accessible values change.

## Decisions

Keep visual deferral and update semantic DOM directly. Reject full off-screen badge rerenders and
focus-only refresh because they respectively give up the performance improvement and miss virtual
cursor navigation. Preserve fixed bundle budgets and unchanged output goldens.
