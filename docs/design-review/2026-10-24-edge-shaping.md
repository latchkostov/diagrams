## Pointer line shaping UX review

Reviewed against UX principles and the approved line-editing design, including a separate designer-agent
code review. Handles are contextual to one selected line, with 24 px hit areas, resize cursors and
14 × 5 px bars at a constant screen size. A covered midpoint moves to the longer label-free span;
short spans expose no competing target. No toolbar, menu row or drawing mode was added.

The controller owns the gesture and its cancellation; the real line dims while a dashed preview moves.
Only drop changes the document. Ineffective drags leave automatic routing intact. Escape and blur
snap back. The lazy surface's held-load/Retry contract preserves focus and skips image readiness.
Export filters remove handles and previews; a far-bend SVG check covers cropping. Presentation and
Live checks cover hidden chrome.

The review found and addressed three issues: diagonal curve samples are no longer mistaken for vertical
segments, node snap candidates are limited to nearby geometry, and a drag along a segment makes no edit.
The pointer adapter was split from React Flow's connection observer so selected-edge code stays lazy.

The owner reversed the former no-manual-waypoints decision on 2026-10-22; drawing-ux records why.
Node-move adaptation, keyboard/touch interaction and interop/agents remain PRs 4–6. Automatic diagonal
or sampled curved routes do not expose invalid handles; the default orthogonal route and custom routes
are editable. Review combined code, browser assertions and visual inspection of the selected-line preview. The HTML viewer excludes authoring code as well as chrome.
