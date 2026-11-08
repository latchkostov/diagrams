## Connection labels survive rejected enlargement

Connection labels remain available for selection, bulk editing and Live path menus when their larger
screen-text size cannot fit. The caption-floor pass previously restored the original styles but then
hid the label anyway, including selected, full-detail labels. It now tries a clear home for the original
caption size first. Labels still hide when neither size fits around cards, pins, solid annotations and
other accepted captions, and return when room opens.

The settled blocker, label, path and obstacle indexes remain intact, as does the inactive-edge render
optimization. No controls, translations, authored routes or simulation behavior change.

## Intentional parity changes

The initial check compared 3,377 goldens: exactly the 17 browser JSON files below change. Every
difference is recovered caption text (previously empty because the label was hidden) or a caption's
CSS translation along its own route to find room. Authored text, routes, node boxes, viewport transforms,
images, exports and all Node-tier goldens are unchanged. The fallback keeps the original font and box
metrics; it does not force the enlarged size over an obstacle.

Paths below are relative to `tests/parity/goldens/browser/`.

| Golden                                      | Explanation                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `layout/aws-serverless-orders.json`         | Two Tidy captions reappear and translate to clear slots.                                                            |
| `layout/black-friday-commerce.json`         | One Tidy caption reappears and translates.                                                                          |
| `layout/cdc-analytics.json`                 | Seven Auto-layout and six Tidy captions reappear in their original slots.                                           |
| `layout/cell-based-bookings.json`           | Three Tidy captions reappear and translate.                                                                         |
| `layout/delivery-dispatch.json`             | Three Tidy captions reappear and translate.                                                                         |
| `layout/gcp-streaming-analytics.json`       | Two Auto-layout and one Tidy caption reappear in their original slots.                                              |
| `layout/observability-pipeline.json`        | Two Tidy captions reappear and translate.                                                                           |
| `layout/outbox-saga-checkout.json`          | One Tidy caption reappears and translates.                                                                          |
| `layout/payments-ledger.json`               | Two Tidy captions reappear and translate.                                                                           |
| `layout/rag-assistant.json`                 | Three Auto-layout and three Tidy captions reappear in their original slots.                                         |
| `layout/recommendations-feature-store.json` | Two Tidy captions reappear and translate; one already-visible neighbour translates to avoid the recovered captions. |
| `render/cdc-analytics.json`                 | Six captions reappear in their original slots.                                                                      |
| `render/cqrs-event-sourcing.json`           | Four captions reappear in their original slots.                                                                     |
| `render/event-driven-data-platform.json`    | Four captions reappear in their original slots.                                                                     |
| `render/kafka-order-pipeline.json`          | Six captions reappear, including the connection used by the Live path menu regression.                              |
| `render/nightly-batch-elt.json`             | Two captions reappear in their original slots.                                                                      |
| `render/rag-assistant.json`                 | Three captions reappear in their original slots.                                                                    |

## Regression coverage

Selected full-detail captions are covered in Overview, Custom and Focus. Temporarily restoring the old
product code fails all three new cases; the existing off-screen Focus text-floor case still passes.
The real card/note obstruction and mixed-fan browser assertions remain unchanged. The indexing regression
retains its 24x operation limit: eightfold input uses 13,016 to 105,547 operations (8.11x).

The presentation regression previously treated the halo as the natural model and required it to differ
from the visible stroke. That conflicts with the PR's shared stroke/halo/hit geometry. It now captures
complete presentation paths first, requires Focus to alter them, then requires presentation to restore
that exact complete snapshot. The truncation and restoration requirements both remain enforced.

The broader sweep also exposed a copy-notice overlap test measuring after its six-second notice had
expired. Both isolated clean-master runs passed (84 cases), so this is not claimed as a reproduced
master failure. The test now installs its clock before navigation, pauses on the visible notice and
advances layout/avoidance frames while checking the same non-overlap condition.
