## Canvas first view trim 3

Canvas first view drops from 381,961 to 374,490 gzip bytes, leaving 8,510 bytes against the
unchanged 383,000-byte budget. The shipped bundle benchmark and a module composition visualizer
were used to inspect the eager graph.

| Gzip bytes               |  Before |   After | After headroom |
| ------------------------ | ------: | ------: | -------------: |
| Entry                    | 107,691 | 107,694 |         15,806 |
| Startup                  | 173,216 | 170,388 |          6,612 |
| Canvas first view        | 381,961 | 374,490 |          8,510 |
| Additional Live download | 126,416 | 127,666 |          7,334 |

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

The settings element retains a stable identity while naming is paused. It receives only the node id,
stencil and modeled props, plus the existing paused revision and reader, so label and description
keystrokes do not rerender the lazy boundary or its settings. The existing typing-render limits stay fixed.

The comparison uses the refreshed merge base `fcb2e15b` (tutorial runtime #285). After that rebase,
playback resource arithmetic moves to `resourceRuntime.ts`, AI-only schema assembly to `aiSimProps.ts`,
and route colours, labels and mix scaling to `routingAppearance.ts`. File-validation schemas and saved
values are unchanged. These helpers load through their existing feature paths; no new UI surface is added.
