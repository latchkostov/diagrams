## Inspector concept consolidation

Consolidate the Inspector's first extraction into one file per contributor-facing concept. This is
an internal refactor with no user-visible change. Panels keep their existing component boundaries,
markup, hook order, effects, dependencies, focus handling, translation calls and timers. Tests and
parity goldens are unchanged; no golden is re-recorded.

The directory goes from 25 files / 3,086 lines to 14 files / 3,020 lines. The 150-line
`src/canvas/Inspector.tsx` shell stays unchanged. Counts include imports and blank lines.

| Final file           | First-round sources (lines)                                                                                         | Final lines |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------- |
| NodePanel.tsx        | NodePanel (157), NodeIdentity (110)                                                                                 | 258         |
| SimulationFields.tsx | NodeSimulation (172), DeviceFields (206), SimInput (91), AutoscalingWorkload (30)                                   | 485         |
| simFields.ts         | simFields (185)                                                                                                     | 185         |
| EdgePanel.tsx        | EdgePanel (192), EdgeAdvanced (90), RelationHint (46), relationship helpers                                         | 352         |
| SettingsEditor.tsx   | SettingsEditor (117)                                                                                                | 117         |
| GroupPanel.tsx       | GroupPanel (144)                                                                                                    | 144         |
| AnnotationPanel.tsx  | AnnotationPanel (225)                                                                                               | 225         |
| DiagramPanel.tsx     | DiagramPanel (132)                                                                                                  | 132         |
| MultiPanel.tsx       | MultiPanel (165), BulkNodes (152), BulkEdges (42), BulkGroups (81), BulkAnnotations (88), bulk controls and helpers | 600         |
| PropsEditor.tsx      | PropsEditor (118), customCount                                                                                      | 121         |
| Disclosure.tsx       | Disclosure (54)                                                                                                     | 54          |
| fields.tsx           | Shared controls from controls (302), formatInert                                                                    | 244         |
| useNameFields.ts     | useNameFields (60)                                                                                                  | 60          |
| types.ts             | types (43), shared by several panels                                                                                | 43          |

Delete `helpers.ts` (formerly 84 lines). Relationship dropdown data and fan-out detection live with
EdgePanel; bulk counts, mixed values and undo tags live with MultiPanel; customCount lives with
PropsEditor; formatInert lives with the shared fields. DiagramPanel and AnnotationPanel import the
existing shared bulk helpers from MultiPanel. No additional split is needed: the largest file is
exactly 600 lines. Keep existing exports; mixed component/helper modules can report advisory Fast
Refresh warnings without changing lint policy.
