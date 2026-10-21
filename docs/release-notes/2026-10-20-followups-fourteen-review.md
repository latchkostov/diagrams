## Follow-ups 14: review corrections

Inset shape ports keep their visible outline attachment and now carry a separate escape point beyond the owning bounding obstacle. Orthogonal searches start and end at those escape points, so triangles and open braces route around intervening nodes. Existing stubs that already escape, including rectangular shapes, keep their exact coordinates.

Shape mounting, pasting and size changes use React Flow's batched ResizeObserver measurements. Outline changes share one forced measurement queue per canvas, with one updateInternals(ids) call per animation frame. Opposite handles on hourglass, comment and brace outlines have separate targets on their visible strokes.

The editor, Lab canvas and overlap audit share the annotation resize adapter. Releasing Shift during a corner resize restores the unconstrained anchored position, including when only one pointer axis moves. The Lab adds an annotation resizing fixture. Extended Mermaid labels decode quoted YAML scalars, including literal tabs, YAML-only escapes and single-quoted labels; handwritten imports retain their following connections.

Output parity checked 2,719 goldens: 0 changed, 0 added, 0 missing and 0 stale. No golden was updated. Rectangular routes and all existing output goldens remain unchanged; the routing regressions exercise previously obstructed triangle and open-brace routes directly.
