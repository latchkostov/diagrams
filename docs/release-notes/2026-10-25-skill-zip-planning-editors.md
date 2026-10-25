## Skill ZIP: remove unreachable planning editors

The production skill ZIP shrinks from **834,148 B to 816,040 B** against master
`7885631553` (18,108 B saved; 18,960 B below the unchanged 835,000 B cap).
The read-only viewer's planning hover readout loads a shared lazy module that also
exports inspector editors. Viewer-only stubs now exclude `RoutingFields.tsx` and
`AutoscalingFields.tsx`, along with their otherwise unused authoring dependencies
(cloud-controller fields, presets, routing edits, target summaries and inspector
layout helpers). The app's editors, viewer planning readouts and simulation engines
retain their behavior. Compression settings, documentation, icons and examples are
unchanged.

Two independent fresh builds produce byte-identical ZIPs, SHA-256
`7155240023a14f4d21fa332c3c6c21a9f9d0c2057049e8471b9d24031abad6b7`.
The committed viewer is regenerated with `pnpm regen` and matches `pnpm skill:check`.
Build regressions cover both viewer formats: they reject the two editor modules
while requiring the planning readout, routing model, autoscaling engine and shared
planning stylesheet. That stylesheet is retained explicitly at the original
dependency position; the viewer's complete style block is byte-identical to master.
Restoring the original bundling makes both regressions fail.

No parity golden changes: only generated viewer implementation bytes change.

### ZIP inventory

All paths are relative to `livediagrams/`. Only the viewer entry changes compressed size.

| Entry                            | Master compressed B | New compressed B |
| -------------------------------- | ------------------: | ---------------: |
| SKILL.md                         |               3,049 |            3,049 |
| reference/format.md              |               7,933 |            7,933 |
| reference/outputs.md             |               2,457 |            2,457 |
| reference/simulation.md          |               4,185 |            4,185 |
| reference/stencils.md            |               6,742 |            6,742 |
| scripts/export-html.mjs          |               3,843 |            3,843 |
| scripts/layout.mjs               |                 963 |              963 |
| scripts/lib/app.mjs              |              37,804 |           37,804 |
| scripts/lib/check.mjs            |               7,523 |            7,523 |
| scripts/lib/icons.json           |             136,660 |          136,660 |
| scripts/lib/inject.mjs           |               1,572 |            1,572 |
| scripts/lib/spec.json            |              12,309 |           12,309 |
| scripts/lib/viewer-template.html |             605,360 |          587,252 |
| scripts/share-link.mjs           |               1,027 |            1,027 |
| scripts/validate.mjs             |                 547 |              547 |

### Largest viewer modules before trimming

Vite's `renderedLength` measures module contributions before final minification;
these are not compressed ZIP sizes.

| Module                                       | Rendered B |
| -------------------------------------------- | ---------: |
| react-dom-client.production.js               |    540,169 |
| @xyflow/react                                |    151,700 |
| src/sim/engine.ts                            |    146,056 |
| @xyflow/system                               |    100,329 |
| src/editor/useEditor.ts                      |     61,779 |
| src/planning/RoutingFields.tsx (removed)     |     59,837 |
| src/stencils/catalog.ts                      |     43,041 |
| src/canvas/CanvasView.tsx                    |     40,029 |
| src/live/controller.ts                       |     39,615 |
| src/live/CapacityPanel.tsx                   |     35,546 |
| src/planning/AutoscalingFields.tsx (removed) |     31,374 |

Higher compression effort and a larger cap were rejected as requested. Removing
documentation, examples, icons or playback code is unnecessary: excluding dormant
authoring code exceeds the requested 4,096 B reduction.
