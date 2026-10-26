## Workbench pre-review polish

Play and Pause use the primary ink fill and contrasting glyph on desktop and phone. Green remains the Live switch and bezel state. Rendered PNG samples measure 16.58:1 in light and 15.44:1 in dark for both glyphs at both sizes, above 4.5:1.

Focus pins share the edge-label collision pass's card blockers. They slide along the frame side or stack inward; an overfull frame never paints a pin over a card. The minimap starts off, with a remembered Minimap checkbox in View; existing saved choices remain respected.

All 18 part-3 states are recaptured in the requested final folder, using the same public examples and viewports. The entry and ZIP budgets remain unchanged.

## Output parity

The browser harness explicitly chooses Minimap through View before opening an example, preserving its established framing fixture while the new fresh-browser default is covered separately. Node outputs, render/selection fixtures, HTML and image exports stay unchanged.

Eight `browser/layout/*.json` goldens intentionally change only the tidy view's edge-label placement/visibility, because pins now reserve clear space around cards before labels are placed:

| Golden                               | Result                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `aws-serverless-orders.json`         | OrderPlaced and OrderPaid rule labels slide; Email becomes visible.                                                 |
| `cell-based-bookings.json`           | Stream and Replication labels slide or return to their route anchors; Cell 2 hides when no clear placement remains. |
| `delivery-dispatch.json`             | Nearby couriers moves along its edge.                                                                               |
| `ev-charging-network.json`           | Session returns to its route anchor.                                                                                |
| `observability-pipeline.json`        | Sampling policy moves along its edge.                                                                               |
| `outbox-saga-checkout.json`          | WAL gains a clear placement and becomes visible.                                                                    |
| `recommendations-feature-store.json` | Arm stats, Update, Append, Bulk load and Reads move; two Features labels hide when no clear placement remains.      |
| `video-on-demand-pipeline.json`      | Transcribe gains a clear placement and becomes visible; Upload failed moves along its edge.                         |

Authored geometry, routes and viewport values remain unchanged in all eight. No tolerances or assertions are loosened.
