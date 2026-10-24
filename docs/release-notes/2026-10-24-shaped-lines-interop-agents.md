## Shaped lines across draw.io and agents

Our draw.io exports now store hand-shaped bends as mxPoint arrays and restore them exactly on import,
including fractional and negative coordinates. Foreign draw.io routes are left to automatic routing,
with a counted import report, because their nodes are rescaled. Connector and waypoint counts are
bounded before pairwise spacing work; malformed coordinates cannot become saved bends.

Agents can set fromSide/toSide when connecting, update either side (null restores automatic selection),
and reset a shaped connection with route: "auto". Descriptions show fixed sides and shaped bend counts.
Agents preserve existing bends on ordinary edits and never author bend coordinates. Insert-between
keeps outer sides and resets bends; full agent/skill layout also resets bends, retaining fixed sides.
The published WebMCP schemas and installed skill assets are regenerated.

Mermaid intentionally continues dropping sides and routes, including from its metadata. Its output
is byte-for-byte unchanged. Infrastructure importers have no geometry and need no change. No canvas
files or bundle budgets change, and this interop feature needs no new simulation showcase.

## Golden inventory

Exactly 23 existing goldens change intentionally; none are added. Paths below are relative to
`tests/parity/goldens/`. All other outputs must remain unchanged.

- `node/agent/describe/aks-app-config-key-vault.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/aws-serverless-orders.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/branch-to-datacentre.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/cell-based-bookings.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/corpus-edge-sides.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/corpus-export-contract.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/corpus-hand-shaped-lines.json`: Appends fixed sides and bend counts to text and focused descriptions; JSON geometry is unchanged.
- `node/agent/describe/delivery-dispatch.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/ev-charging-network.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/event-driven-data-platform.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/nightly-batch-elt.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/notification-fanout.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/outbox-saga-checkout.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/rag-assistant.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/recommendations-feature-store.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/describe/webhook-ingestion.json`: Appends fixed sides to text descriptions (and focused descriptions where present).
- `node/agent/tools.json`: Publishes side selection, nullable side updates, automatic route reset and insert-between reset guidance.
- `node/exports/drawio-meta/corpus-hand-shaped-lines.json`: Records the changed icon-bearing XML fingerprint and the four routes preserved on re-import.
- `node/exports/drawio/corpus-hand-shaped-lines.drawio`: Writes mxPoint arrays for all four shaped connections in the existing fixture.
- `node/i18n/catalogs.json`: Adds the foreign-route report message and English fallbacks for untranslated locales.
- `node/skill/corpus-hand-shaped-lines.files.json`: Updates the complete format-reference fingerprint for agent side/reset guidance; spec data is unchanged.
- `node/skill/files.json`: Fingerprints the updated skill entrypoint, format reference and output interoperability guidance.
- `node/skill/public-schemas.json`: Updates the ops schema fingerprint and shared Side definition inventory.

## Validation

The targeted interop and agent unit tests pass. Temporarily restoring the prior implementation
produced 14 regression failures; the full-layout reset regression separately fails without its fix.
The production skill ZIP is 830,929 bytes, below the unchanged 835,000-byte limit.
