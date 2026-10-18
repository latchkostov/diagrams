## Inspector extraction UX review

No controls, copy, styles, layout, focus stops or gestures are added or removed. The Inspector's shell
and selection-specific sections keep the same element order and markup. Node identity and simulation,
and advanced connection fields, gain component boundaries without DOM wrappers or new hooks.

Keep name-edit state and focus effects in their original owners. Keep the existing resize handle,
routing/planning components and findings slots in place. Do not add wrappers just to rename these
already separate surfaces. CanvasView.tsx and canvas.css remain outside this branch's scope.

A structural comparison against the original Inspector covers all 60 declarations, expanding the
three extracted JSX sections and checking their prop wiring. It ignores only module exports, comments
and formatting. Existing Inspector, text-field, relationship, routing, planning, zone and neighboring
interaction tests provide the behavioral checks; no test expectations are changed for this refactor.
