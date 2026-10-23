## Route model and router UX review

The designer-agent source review found two issues: a label wrapper could activate Reset when its informational state was clicked, and removing the focused Reset button could drop focus onto the page. Both are fixed: Route uses a group, Reset is an insp-link with a specific accessible name, and the interaction controller focuses the surviving Advanced disclosure before the action disappears. E2E covers state clicks, keyboard activation, focus recovery, both reset surfaces and one-step Undo.

No top-level controls were added. Reset appears only for shaped lines, under Route after the side controls, and in Advanced; multiple-route reset is palette-only. Fixed sides remain visible and survive reset. The reviewer confirmed both findings resolved and reported no further source-review findings; functional browser coverage is automated, not a manual whole-app walkthrough.

## Scope and budgets

No shaping gestures, node carry/reset, segment keyboard/touch controls or new agent/draw.io authoring were added. Optional saved-route geometry and existing dependency/deny detail rendering load on demand; their recovery UI stays in the parent chunks. Budgets remain unchanged. The skill packager uses more thorough lossless DEFLATE block splitting for its two large payloads.
