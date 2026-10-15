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
| `partitions`     | Partitions      | A node explicitly configures more than one partition.                  |
| `rateLimits`     | Rate limits     | A rate-limiter stencil or explicit API quota models a rate limit.      |
| `networkDevices` | Network devices | A router, switch, firewall or ADC from the supported network families. |
| `autoscaling`    | Autoscaling     | An explicit p3-a1 resource workload with HPA enabled.                  |

`scripts/example-shows.ts` computes these tags from actual diagram settings. Do not infer autoscaling
from the presence of a serverless vendor icon: the example must demonstrate the feature. Add a tag
only with evidence, translations and filtering tests. Unknown tags remain readable as their stable IDs.

An example remains visibly labelled Example until the first changed canvas snapshot is saved. That
save creates an owned entry (a uniquely named `(copy)` for structural edits, or the title you chose) in Your diagrams, preserving the canvas
identity and undo history. A cleared name is stored as Untitled while the editable field stays empty. The original gets a fresh identity for its next open. Storage failure preserves the
current canvas and offers a save/export recovery notice; it does not replace the original session.
Existing example autosaves are read for compatibility and carried into the copy on the next edit.
