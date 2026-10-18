# Example gallery metadata

The picker names your work; Browse examples opens a lazy gallery. The start card keeps four featured
examples and links to the same gallery. Search matches every word across title, slug, description,
summary and translated feature tags. Themes retain catalog order; items retain their order within a theme.

`exampleMetadataPlugin` reads only the top-level public JSON files at build time, producing titles,
descriptions, thumbnails, an optional first saved `simulation` ID and optional `shows?: string[]`.
Full public diagram JSON is fetched only when opened. The development-only catalog stays in its
Examples submenu in the picker and is included generically in the gallery. Agent listing and opening use the existing catalog.

Keep the feature vocabulary small. Stable IDs are translated by `src/examples/gallery.ts`:

| ID               | Label           | Evidence required                                                      |
| ---------------- | --------------- | ---------------------------------------------------------------------- |
| `faultDrills`    | Fault drills    | An executable timeline fault with a declared target.                   |
| `partitions`     | Partitions      | A node explicitly configures more than one partition.                  |
| `rateLimits`     | Rate limits     | A rate-limiter stencil or explicit API quota models a rate limit.      |
| `networkDevices` | Network devices | A router, switch, firewall or ADC from the supported network families. |
| `autoscaling`    | Autoscaling     | An explicit p3-a1 resource workload with an executable policy on.      |

`scripts/example-shows.ts` computes these tags from actual diagram settings. Do not infer autoscaling
from the presence of a serverless vendor icon: the example must demonstrate the feature. Add a tag
only with evidence, translations and filtering tests. Unknown tags remain readable as their stable IDs.

An example remains visibly labelled Example until the first changed canvas snapshot is saved. That
save creates an owned entry (a uniquely named `(copy)` for structural edits, or the title you chose) in Your diagrams, preserving the canvas
identity and undo history. A cleared name is stored as Untitled while the editable field stays empty. The original gets a fresh identity for its next open. Storage failure preserves the
current canvas and offers a save/export recovery notice; it does not replace the original session.
Existing example autosaves are read for compatibility and carried into the copy on the next edit.

Large showcases (40–150 nodes: `black-friday-commerce`, `cell-based-bookings`, `payments-ledger`,
`delivery-dispatch`, `ev-charging-network`, `recommendations-feature-store`, `video-on-demand-pipeline`,
`observability-pipeline`, `hybrid-enterprise-network`) make up the **Full systems** theme, first in the gallery. They are
invented systems whose saved stories start a narrated note within ten seconds of Live; each note's focus takes the
camera, so a large diagram stays readable while a story plays. Keep every note's focus a close-up (at least 60% zoom
on a desktop; on a phone the canvas's 15% minimum zoom binds, and the note pans to its cards), the diagrams under live view's adaptive threshold
(about 1,000 nodes plus connections), free of unexplained checks findings, and covered by
`src/examples/largeShowcases.test.ts`.

## Retiring an example

Never just delete one. Add it to `RETIRED_EXAMPLES` in `src/examples/retired.ts` with its replacement and a story
for each of its saved simulation ids. The entry rewrites a retired `?example=` (and its `sim`) before anything
reads the address, so links, shared and embedded URLs keep working; a remembered last canvas reopens as the
replacement; and edits saved under the old slug (an example autosave from before copies) become one of your
diagrams at startup. Repoint tests that used it as a fixture, freeze a copy where a test pins its exact behaviour
(`tests/parity/corpus`, `src/test/fixtures`), and let `pnpm parity:update` remove its goldens.

| Retired                      | Opens                   |
| ---------------------------- | ----------------------- |
| `multi-region-active-active` | `cell-based-bookings`   |
| `iot-telemetry`              | `ev-charging-network`   |
| `aws-fanout`                 | `aws-serverless-orders` |
| `autoscaling-image-workers`  | `autoscaling-basics`    |
| `keda-render-workers`        | `autoscaling-basics`    |
