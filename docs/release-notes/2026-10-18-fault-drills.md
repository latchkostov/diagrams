## Fault drills: boundary outages, slow dependencies, failures and partitions

Live right-click menus have one **Fault** submenu: **Take down / Restore** on a boundary (including nested
members), **Slow down → 2× / 5× / 10×** and **Fail → 10% / 50%** on processing nodes, and **Cut link / Restore link**
on flows crossing two boundaries. Slowdown/failure overlays can be cleared together. No top-bar or live-bar buttons
were added. Outage boundaries turn grey with a dashed border and × marker. Existing node down/up actions now live
inside Fault, replacing their Kill/Revive wording. A member’s Restore action explains when its boundary must be
restored first.

Timeline **Add step** offers four named presets: **Zone outage**, **Region connectivity**, **Slow dependency** and
**Error spike**. Their target, magnitude and time remain editable; restoration is another fault step. Faults overlay
current settings, compose across nested boundaries and survive checkpoints. Slowdown affects new attempts, including
managed service latency and resource CPU work; repeated choices replace the factor. Boundary membership/ancestry
changes restart playback as topology changes; ordinary moves and boundary renames preserve it. Seeking a saved drill
replays identically. Broker deliveries wait behind a cut, including in-flight deliveries returned without spending
an attempt. Pushed messages and Requests fail/drop under the agreed interim semantics.

The public **Zone outage drill** gallery example has two runs. At 3 s zone b goes down; health checks immediately
shift new requests to zone a and lose zero messages. The comparison without health checks visibly loses 26 checkouts.
Dropped counts stay visible on down members during a boundary fault, so that difference needs no hover.
Its evidence-backed **Fault drills** tag, example tests, Lab preview and output goldens cover this behavior. Intentional
fault losses retain Checks' existing planned-loss treatment; an expectation of zero loss still makes a loss a finding.

Agents and WebMCP can save named drills through `set_simulation.faults`, with the usual element references and seconds.
`describe_diagram`, native schemas and the installed skill preserve and validate the fault timeline. New UI words use
`t()`; untranslated languages use English fallback. Dependency outages and the run-end drill report remain PR 2.

## Output parity and size

All existing diagram simulation, layout, renderer, import and export goldens remain unchanged. New example goldens
record its simulations/traces, planning/checks/evidence, native/draw.io/Mermaid/HTML outputs, agent operations, skill
validation, browser drawing and layout. The new geometry unit snapshot records only this example.

Five shared goldens change intentionally:

- `node/agent/tools.json`: the fault/drill input schema, empty traffic allowed for a fault-only drill, and tool description.
- `node/skill/public-schemas.json`: fingerprints and byte counts of the native schemas and agent simulation contract.
- `node/skill/files.json`: the authored fault/drill reference and the generated stencil-frequency reference.
- `node/skill/current-stencils.json`: the same frequency-based recommendation list changes because the public example
  uses ECS, ELB, DynamoDB and a user stencil.
- `node/i18n/catalogs.json`: 31 new messages, including the gallery feature label, their namespace hashes and fallback counts.

The production entry remains under its unchanged 123.5 kB gzip budget (107.1 kB). The downloadable skill grows to
about 803 kB with fault playback and its contract; its separate zip ceiling increases from 800 to 805 kB. No plugin
version changes.
