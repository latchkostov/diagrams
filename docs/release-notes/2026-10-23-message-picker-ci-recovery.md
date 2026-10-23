## Message picker and Request inspector recovery

Message controls now have their own collapsed **Messages** section on flow connections. **Simulation** keeps
Request wait, timeout, pool and retry controls first in keyboard order, and appears only where a connection has
simulation controls. A held or failed message-control download cannot displace those controls; recovery remains
in the existing toast outside the downloaded chunk.

Live hover cards now recognize connection labels as well as lines. This also handles a pointer aimed at the
centre of a line when its label occupies that point. The webhook example's callback uses the top ports so
its return route no longer crosses the dead-letter route's hover point. The compact-summary test uses its
original node/line targets and unchanged no-scroll assertions; the frame remains 320 × 332 pixels.

The agent check expectation now counts the message-loop rule added by this branch: 14 checks, with the saved
ignore still honored. The webhook geometry snapshot changes intentionally: the callback runs above the
nodes, and the neighboring ports and routes move accordingly. Its output goldens record that route change;
simulation and message propagation behavior are unchanged.

## Golden changes

Every changed parity golden is for `webhook-ingestion`:

- `node/agent/describe` and `node/agent/edit` retain the callback's two explicit top-port fields.
- `node/exports/native` preserves those fields in the diagram file.
- `node/exports/drawio` emits the top connector endpoints; `node/exports/drawio-meta` preserves them in
  the round trip and updates the exported file's byte count and hash.
- `node/exports/html/webhook-ingestion.dark.json` and `.light.json` include the two fields in their
  embedded diagram, with corresponding file byte counts and hashes.
- `node/skill/scripts` preserves the fields and records the share payload's new byte count and hash.
- `node/routes` records the callback's upper route and the neighboring port/route adjustments.
- `browser/render` and `browser/layout` record the resulting canvas and layout route geometry.

The corresponding `src/canvas/geometry` snapshot changes for the same routing reason. No other example
or simulation golden is intended to change.
