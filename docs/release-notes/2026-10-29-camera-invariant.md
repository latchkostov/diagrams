## Camera settling across narration, menus and slow motion

When a menu is open, narration has sampled the pane, and a panel change is immediately
followed by slow motion, the camera now plans the take on the next matching pane frame.
Previously, deferring the panel discarded the sample even though no frame had passed,
delaying the take by another frame. A frame that actually passes under deferral still
invalidates the sample. Opening a menu over pending canvas work still starts settling afresh.

The controller property and its invariants are unchanged. Fixed regression cases cover
the Nightly counterexample and a rendered frame under deferral. No output goldens change.
