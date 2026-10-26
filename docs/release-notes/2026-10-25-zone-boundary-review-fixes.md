## Zone and boundary improvements: review fixes

Imported boundary and annotation radii now discard nonnumeric/nonfinite values and clamp finite values to 0–40 before canvas rendering. Both published schemas enforce the same 40-pixel maximum. Slider values and typed commits respect fractional steps relative to the minimum.

Align and Distribute treat each outermost selected boundary and its descendants as one unit. Select All preserves nested boundary, node and annotation offsets, moving each once in one Undo step. Position normalization indexes boundary IDs once rather than scanning every node per position. Smart guides exclude moving subtrees, admit stationary backdrops during backdrop drags, and retain stationary Alt-drag originals.

The public inline rate-limit example now shows three aligned rounded boundaries and a rounded request-path zone. Live traffic and quota rejections still appear within ten seconds. The derived gallery tag and radius label are translated in all 37 catalogs.

## Intended golden changes

All paths below are relative to `tests/parity/goldens/`. No simulation, routing, capacity or unrelated example output changes are intended.

| Golden                                                    | Reason                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `node/exports/native/inline-rate-limit.diagram.json`      | Saves the three rounded boundaries, memberships, zone and expanded description.                   |
| `node/exports/drawio/inline-rate-limit.drawio`            | Adds the showcase boundary containers and zone to draw.io export.                                 |
| `node/exports/drawio-meta/inline-rate-limit.json`         | Corresponding draw.io bytes, hashes and imported container counts change.                         |
| `node/exports/mermaid/inline-rate-limit.mmd`              | Adds boundary subgraphs and the zone description.                                                 |
| `node/exports/mermaid-plain/inline-rate-limit.mmd`        | The plain Mermaid variant gains the same subgraphs and description.                               |
| `node/exports/mermaid-read/inline-rate-limit.json`        | Reading those subgraphs produces boundary-aware layout positions.                                 |
| `node/exports/html/inline-rate-limit.light.json`          | Light interactive export embeds the added diagram content; size, hash and summary change.         |
| `node/exports/html/inline-rate-limit.dark.json`           | Dark interactive export embeds the same added content.                                            |
| `node/skill/public-schemas.json`                          | Native v1/v2 schemas publish the bounded borderRadius fields for groups and annotations.          |
| `node/skill/corpus-hand-shaped-lines.public-schemas.json` | The corpus's published schema fingerprints reflect those same fields.                             |
| `node/skill/validate/inline-rate-limit.txt`               | The valid showcase reports three boundaries.                                                      |
| `node/skill/scripts/inline-rate-limit.json`               | CLI layout fits the three added boundaries; scale preserves their geometry.                       |
| `node/agent/describe/inline-rate-limit.json`              | Agent description includes the boundaries, zone and expanded description.                         |
| `node/agent/edit/inline-rate-limit.json`                  | Agent choices include the zone; placement accounts for the new containers.                        |
| `node/i18n/catalogs.json`                                 | Catalog coverage and inspector/examples fingerprints include the two translated labels.           |
| `node/layout/inline-rate-limit.json`                      | Skill layout reports the three fitted boundaries.                                                 |
| `browser/render/inline-rate-limit.json`                   | The opening canvas includes the rounded boundaries and zone, with their fit and routing geometry. |
| `browser/layout/inline-rate-limit.json`                   | Auto-layout and Tidy snapshots include the added container geometry and fitted viewport.          |

## Verification and design choices

Focused tests cover malformed native/clipboard imports, schema endpoints, Slider numeric commits/cancellation/disabled state, native keyboard and pointer editing, Undo/persistence, empty zone naming, nested arrangement, and operation growth. Temporarily reverting each fix makes its regression fail; mutations excluding backdrops or admitting moving descendants also fail. The public example's ten-second demonstration, routing and gallery checks pass.

Kept the contributor's contextual inspector design and native range keyboard interaction. Rejected an integer-only Slider API because the reusable control already accepts fractional steps, and independent member arrangement because containment is intentional. No controls or bundle limits were added or raised. This fix round uses targeted verification; the full suite remains with PR CI.
