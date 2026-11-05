## Export readiness and canvas surface audit

Exports keep the natural diagram, without adding controls or changing focus,
layout, chrome or loading recovery. Default lazy shells and the custom Live
readout shell carry one shared exclusion class consumed by the image clone filter.
Pending and failed optional UI is skipped immediately; it cannot delay export
indefinitely. Awaiting optional tooltip downloads would add unnecessary latency.
Output-bearing surfaces retain their existing readiness and cancellation behavior.
HTML export uses model serialization, so editor loading shells cannot enter its
payload; the downloaded viewer remains independently lazy and interactive.

| Surface                                                                              | Policy and capture behavior                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `edge.reader`                                                                        | Skip. The reader's default shell sits outside the viewport; its loaded children can portal into the label layer.                                                                       |
| `edge.message-tip`                                                                   | Skip. Its default shell portals into the captured label layer and is now excluded. The loaded hover reader returns no card; a keyboard card closes when the export dialog takes focus. |
| `edge.shaping`                                                                       | Skip. Its custom placeholder returns null; loaded segment/reconnect handles and previews use existing clone exclusions.                                                                |
| `canvas.frame-detail`                                                                | Skip. The default shell and screen decorations sit outside the viewport; boundary/zone chips in the viewport are already excluded. Image capture suspends frame detail.                |
| `canvas.presence`                                                                    | Skip. Default shell is outside the viewport; loaded viewport decorations use the excluded `presence-layer`.                                                                            |
| `canvas.node-tips`                                                                   | Skip. Default shell and loaded screen-space tooltip sit outside the viewport. Its nested translated-description fallback remains there.                                                |
| `canvas.check-markers`                                                               | Skip. Default shell is outside the viewport; loaded viewport markers use the excluded `check-markers`.                                                                                 |
| `live.node-details`, `live.edge-details`                                             | Skip. Custom `DetailsLoading` shells can sit inside the badge viewport and are now excluded. Loaded hover cards portal outside it.                                                     |
| `live.sections`, `live.history`                                                      | Skip. Their shells and loaded detail bodies live inside the screen-space hover card or inspector.                                                                                      |
| `live.calls`, `live.threads`                                                         | Await. Default shells can be inside the viewport, are excluded defensively, and readiness waits for the loaded call pills and thread meters.                                           |
| `live.capacity-analysis`                                                             | Await. Its custom panel placeholder is outside the viewport (or null); loaded analysis supplies the exported capacity rings/readouts.                                                  |
| `live.session`, `live.cache`                                                         | Await. Default session shells are outside the viewport; readiness discovers nested output-bearing surfaces before capture.                                                             |
| `live.note`                                                                          | Await. Narration is outside the SVG viewport; recording uses its loaded content.                                                                                                       |
| `live.edit-capacity`, `live.bottleneck`, `live.trouble`, `live.events`, `live.trace` | Skip. These canvas-adjacent shells/callouts/panels remain outside the captured viewport.                                                                                               |

The loaded edge message reader also adds accessibility titles to its edge. Those
titles are preserved: the existing branch-to-datacentre goldens include them.
The held-chunk golden regression uses hand-shaped-lines, whose goldens have no
incidental hover titles, alongside the branch-to-datacentre same-run byte checks.

Canvas palettes, selection dialogs, inspector panels, Live panels, menus and dialogs
also live outside the viewport. Their custom loading UI requires no clone wrapper
or layout change. SVG/PNG share the same image filter. HTML serializes the model.

Rejected: waiting for skip-policy surfaces, a special case for the message-tip test
id, and changing golden files or bundle reserves. A shared semantic marker covers
all default shells and the one custom readout shell in the captured viewport.

The encrypted HTML test observes its success notification at download time, using
the existing helper callback before saving the file. This keeps the notification
assertion tied to the export outcome when filesystem copying is slow; its text,
encrypted payload checks and viewer playback assertions remain checked.
