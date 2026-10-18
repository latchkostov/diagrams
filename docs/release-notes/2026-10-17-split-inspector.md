## Internal Inspector section extraction

Split the 2,938-line Inspector into a 150-line panel shell and section components in
`src/canvas/inspector/`. This is an internal refactor with no user-visible change. The shell keeps its
focus-request layout effect; node state and routing intent stay in NodePanel; the shared name-field
hook keeps its effects, dependencies, microtask and animation-frame behavior.

DOM structure, classes, test ids, ARIA, focus order, keyboard handling and translation calls are
unchanged. Existing routing, planning, findings and resize components retain their original positions.
CanvasView.tsx and canvas.css are untouched. No tests or golden files are changed.

The i18n lint allowlist now covers the extracted modules. Sync refreshed the generated skill viewer
from the shared canvas code; its compiled bytes change, with no intended change to rendered output.
Output parity compared all 2,196 goldens: zero changed, added, missing or stale. All 77 Linux browser
parity cases passed; no golden was re-recorded. The entry remains 107.0 kB gzip, the shared canvas
chunk is unchanged at 91.94 kB gzip, and the canvas chunk changes from 105.96 to 106.29 kB gzip (0.3%).
No new startup or canvas chunks are added.

The final unit run passed 9,645 tests with four skipped and no type errors. An earlier run hit the
unrelated random filename collision documented in
`docs/backlog/2026-10-17-random-export-filename-test.md`; a passing rerun does not resolve that finding.

File map (line counts after extraction):

| File in src/canvas/inspector/ | Lines | Responsibility                                                 |
| ----------------------------- | ----- | -------------------------------------------------------------- |
| NodePanel.tsx                 | 157   | Node state and section composition                             |
| NodeIdentity.tsx              | 110   | Stencil, names, connection name and boundary membership        |
| NodeSimulation.tsx            | 172   | Node simulation section                                        |
| DeviceFields.tsx              | 206   | Device capacity and availability fields                        |
| AutoscalingWorkload.tsx       | 30    | Existing autoscaling wrapper                                   |
| EdgePanel.tsx                 | 192   | Connection and relationship fields                             |
| EdgeAdvanced.tsx              | 90    | Attachment sides, timing, filters and custom properties        |
| RelationHint.tsx              | 46    | Existing dependency suggestion                                 |
| SettingsEditor.tsx            | 117   | Configuration settings                                         |
| GroupPanel.tsx                | 144   | Boundary identity, appearance, dimensions and actions          |
| AnnotationPanel.tsx           | 225   | Annotation and zone fields                                     |
| DiagramPanel.tsx              | 132   | Diagram identity, appearance and planning entry points         |
| MultiPanel.tsx                | 165   | Arrangement and mixed-selection composition                    |
| BulkNodes.tsx                 | 152   | Shared node fields                                             |
| BulkEdges.tsx                 | 42    | Shared connection fields                                       |
| BulkGroups.tsx                | 81    | Shared boundary appearance                                     |
| BulkAnnotations.tsx           | 88    | Shared annotation appearance                                   |
| PropsEditor.tsx               | 118   | Custom-property controls and parsing                           |
| Disclosure.tsx                | 54    | Remembered section disclosure                                  |
| SimInput.tsx                  | 91    | Existing draft-preserving simulation input                     |
| simFields.ts                  | 185   | Existing simulation field definitions and formatting           |
| controls.tsx                  | 302   | Shared rows, swatches, size, side, segmented and copy controls |
| helpers.ts                    | 84    | Counts, shared values, relationships and undo tags             |
| useNameFields.ts              | 60    | Existing name-edit transactions and keyboard handling          |
| types.ts                      | 43    | Inspector props, also re-exported from Inspector.tsx           |
