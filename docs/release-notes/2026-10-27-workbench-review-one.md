## Workbench review round one

Focus and Follow preserve hand-shaped connection tracks while spacing automatic routes. Connections to pins now use the normal router's solid annotation, boundary-header and caption obstacles. Selected-node accents take precedence over narrated Live connections.

The 11 px label floor measures a naturally sized pill and its text line rectangles before collision placement, retaining the original font if no enlarged box fits. Visible node chips reserve room before edge labels are placed, including the large commerce Follow view.

Regression coverage includes overlapping and nearby saved tracks, pin obstacles, complete text at fractional zoom, selection during narration, required bottom-neighbour pins, and the narrated phone subject before and after expanding the note.

## Intentional parity changes

Only `tests/parity/goldens/browser/layout/<name>.json` records below change. In every file, only `tidy.labels[*].style` changes: Tidy up selects all nodes, enabling the measured 11 px label floor. Accepted pills gain natural width/height and enough line height for the actual text rectangles, with placement adjusted for that larger box; rejected enlargements keep the original font. Node positions, routes, viewport, label words and Auto-layout output stay identical. Every other golden stays unchanged.

- `aks-app-config-key-vault`: measured label pill styles and any resulting placement.
- `aws-serverless-orders`: measured label pill styles and any resulting placement.
- `azure-service-bus-integration`: measured label pill styles and any resulting placement.
- `black-friday-commerce`: measured label pill styles and any resulting placement.
- `cdc-analytics`: measured label pill styles and any resulting placement.
- `cell-based-bookings`: measured label pill styles and any resulting placement.
- `contoso-dmz`: measured label pill styles and any resulting placement.
- `delivery-dispatch`: measured label pill styles and any resulting placement.
- `ev-charging-network`: measured label pill styles and any resulting placement.
- `event-driven-data-platform`: measured label pill styles and any resulting placement.
- `gcp-streaming-analytics`: measured label pill styles and any resulting placement.
- `hybrid-enterprise-network`: measured label pill styles and any resulting placement.
- `observability-pipeline`: measured label pill styles and any resulting placement.
- `outbox-saga-checkout`: measured label pill styles and any resulting placement.
- `payments-ledger`: measured label pill styles and any resulting placement.
- `rag-assistant`: measured label pill styles and any resulting placement.
- `recommendations-feature-store`: measured label pill styles and any resulting placement.
- `video-on-demand-pipeline`: measured label pill styles and any resulting placement.

## Verification

The targeted routing/camera units pass (57 tests). Removing fixed-route protection fails both overlapping and nearby hand-shaped-track regressions; dropping the solid obstacle collection fails the pin-routing regression. Removing measured label sizing fails the fractional-zoom text-box regression. Restoring spotlight ink over the selection accent fails both themes. The chip-clearance regression also fails against the bundle without chip blockers.

Both affected browser specs pass five native repetitions (35 council cases, 25 follow-up cases after the final text-leading adjustment). The Linux six-worker repetition gate could not enter the shared budget and exited 75; it produced no SUMMARY. The full parity check compared 3,178 goldens and found only the 18 intended style changes listed above; its Node tier passed 1,873 tests. The reviewed browser records are updated with `pnpm parity:update --tier browser render`; all 82 filtered browser tests pass.

The final production build and size check pass: entry 111.3 kB gzip against 123.5 kB, viewer 622.4 kB against 805.0 kB. The deterministic ZIP regression passes, and the built ZIP is 827,468 bytes against the unchanged 835,000-byte cap. Regeneration and i18n validation pass with the existing translation warnings and zero errors.
