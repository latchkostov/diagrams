## Fault drill review fixes

Boundary membership and ancestry now invalidate playback, scaling plans and Checks evidence through one shared simulation-content projection. Moving or renaming a boundary without changing membership does not invalidate results.

The engine reports each loss's incoming connection and resolved fault cause. Checks exempts only actual intentional losses, so cutting an unused connection cannot hide processing failures on healthy inputs. Intentional failures and outages in one run are counted together.

Unavailable drill presets and fault kinds are disabled with guidance. Invalid drafts cannot run or save, and every planning revision validates scheduled faults before playback. Removing a running fault's eligible target leaves Live usable with a repair message.

Fault target lists use linear indexes and are cached until the document changes. Boundary outages update indexed descendants and track active outages; unchanged faults do no descendant work. A timeline requiring more than 1,000,000 cumulative node updates is refused before engine allocation.

The command palette retains Slow down and Fail in magnitude action names. Cut Request and Message connections override idle-edge styling in both themes. Fault targets follow their kind, and native validation rejects unexpected fault fields. Browser persistence coverage now asserts complete fault payloads and reopened controls, including clearing preset metadata when the kind changes. The gallery regression includes the existing zone-outage showcase in its reliability list.

Two parity fingerprints are refreshed after syncing with the latency feature:

- `tests/parity/goldens/node/i18n/catalogs.json`: six new English fault messages add catalog entries, fallback counts and fault-area hashes; the merged catalog also retains the upstream latency messages.
- `tests/parity/goldens/node/skill/current-stencils.json`: the regenerated reference's "Most used in the examples" order reflects both showcases (DynamoDB/Postgres and ECS change positions). Its byte count stays 17,476; only its hash changes.

Existing diagram, simulation, evidence, layout and export goldens must remain unchanged.
