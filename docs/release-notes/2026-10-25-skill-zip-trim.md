## Skill ZIP payload trim

The production skill ZIP shrinks from **834,507 B to 832,194 B** (2,313 B saved), measured against
master `5a7986fbbd7ca4a1883a6932a2ec44ebbc018517`. The fixed 835,000 B cap and compression settings
stay unchanged. The read-only viewer excludes quick-add placement, its connected menu, the placement
outline and box-selection authoring, using the existing viewer module swaps. These gestures were
already disabled in the viewer. Both Interactive HTML and the external platform viewer retain their
rendering, playback, pan and zoom behavior; the editor keeps the original modules.

No features, examples, icons, fonts or skill documentation were removed. No parity goldens changed.
The generated viewer template changes implementation bytes only. Two fresh ZIP builds have the same
SHA-256: `248e3656447e610488b7f083e77c6cb2f7ac2861d569d4e03bd874f5040d0599`.

### ZIP entries

Compressed bytes, with the common `livediagrams/` prefix omitted. Every entry except the viewer is
byte-for-byte unchanged. ZIP headers account for the remaining 2,174 B.

| Entry                            |  Master | Trimmed |
| -------------------------------- | ------: | ------: |
| scripts/lib/viewer-template.html | 605,721 | 603,408 |
| scripts/lib/icons.json           | 136,660 | 136,660 |
| scripts/lib/app.mjs              |  37,803 |  37,803 |
| scripts/lib/spec.json            |  12,309 |  12,309 |
| reference/format.md              |   7,933 |   7,933 |
| scripts/lib/check.mjs            |   7,523 |   7,523 |
| reference/stencils.md            |   6,741 |   6,741 |
| reference/simulation.md          |   4,185 |   4,185 |
| scripts/export-html.mjs          |   3,843 |   3,843 |
| SKILL.md                         |   3,049 |   3,049 |
| reference/outputs.md             |   2,457 |   2,457 |
| scripts/lib/inject.mjs           |   1,572 |   1,572 |
| scripts/share-link.mjs           |   1,027 |   1,027 |
| scripts/layout.mjs               |     963 |     963 |
| scripts/validate.mjs             |     547 |     547 |

### Viewer module measurements

Largest master modules by bundler `renderedLength` (before final chunk minification; module sizes are
not independently compressed ZIP sizes):

| Module                         |   Bytes |
| ------------------------------ | ------: |
| React DOM client production    | 540,169 |
| React Flow                     | 151,700 |
| src/sim/engine.ts              | 146,056 |
| React Flow system              | 100,329 |
| src/editor/useEditor.ts        |  61,778 |
| src/planning/RoutingFields.tsx |  59,837 |
| src/stencils/catalog.ts        |  43,041 |
| src/canvas/CanvasView.tsx      |  39,674 |
| src/live/controller.ts         |  39,615 |
| src/live/CapacityPanel.tsx     |  35,546 |

Higher-effort compression and raising the budget were rejected as outside the payload-only goal.
The largest runtime modules support existing behavior; narrowly excluding disabled authoring code
keeps this change smaller and preserves the skill's file layout.
