## Viewport decoration work

No controls or chrome added. Large diagrams retain every React Flow node, edge, accessible name,
port and keyboard target. Only screen-decoration measurements and identity fitting are deferred
outside the viewport plus a 256 screen-pixel margin. Small diagrams keep the complete pass.

Selection, keyboard focus, dragging, connection endpoints and camera subjects stay eligible.
An entering natural card receives its identity synchronously with a translation-only store commit;
the held-frame browser regression checks its name and icon in Edit and Live. Find and zoom to
selection continue to use the complete model and DOM. Live status decoration still updates every
part, including off-screen parts, so entering cards do not need a state catch-up protocol.

Focus and Follow retain their complete clipping/pin geometry. Boundary titles, annotations,
chip fitting and merged chip paths retain their existing behavior. Image capture resets every
card through the existing frame-capture suspension, including cards whose fitting was deferred.
No simulation, planning or stencil feature was added, so no new showcase example is needed.

DOM culling was rejected because retaining the existing accessible and keyboard tree is simpler
than maintaining a second tree. Skipping Live writes was rejected because it needs pan-time
resynchronization and would consume the almost exhausted Live chunk reserve. Chip fitting was
left intact because its obstacle budget and merged paths depend on the complete input.
