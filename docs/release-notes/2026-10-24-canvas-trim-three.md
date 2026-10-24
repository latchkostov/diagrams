## Canvas first view trim 3

Canvas first view drops from 380,960 to 374,094 gzip bytes, leaving 8,906 bytes against the
unchanged 383,000-byte budget. The shipped bundle benchmark and a module composition visualizer
were used to inspect the eager graph.

| Gzip bytes               |  Before |   After | After headroom |
| ------------------------ | ------: | ------: | -------------: |
| Entry                    | 107,633 | 107,649 |         15,851 |
| Startup                  | 173,158 | 171,134 |          5,866 |
| Canvas first view        | 380,960 | 374,094 |          8,906 |
| Additional Live download | 126,369 | 126,976 |          8,024 |

Node settings now load through the registered `inspector.node-settings` surface. Naming and the
searchable menu stay eager. Routing, simulation, planning and custom-property settings move to
`NodeSettings.tsx`; their field, disclosure and settings metadata dependencies leave the first view.
Autoscaling authoring presets move to `autoscalingLessons.ts`, settings paste/editor codecs to
`settingsInput.ts`, and eager routing topology edits are separated from `routingEdits.ts` form helpers.
The shared lazy surface runtime is explicitly grouped in `canvas-shared`, so consumers of the helper
cannot acquire `CanvasView` through that runtime.

Menu deferral is not included: native input preserves editing but a queued Enter still needs an exact
ownership transition to naming before later typing or Escape. The current implementation and draft
#273 remain unchanged rather than landing an unproven transfer. No new simulation or stencil feature
is introduced, so no showcase example is needed. No output golden is intentionally changed or recorded.
Startup and additional Live download remain below the warning floor; their fixed budgets still pass.
