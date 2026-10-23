## Vendor routing inheritance

Vendor variants now resolve their parent before checking HTTP route-table support.
APISIX, Apigee and the five CDN variants retain the same routing inspector,
authored-table playback and capacity analysis as their parents, including tables
retained when changing a node's stencil. An empty table rejects unmatched Requests.
The capability audit also normalizes admission presets, profiles, network devices,
edge defaults, checks and scaler predicates through the shared parent resolver.

## Icon caching

Production SVG URLs now contain each icon's own content hash. Adding or editing a
glyph no longer invalidates cached URLs for unchanged glyphs. The compact manifest
retains individual downloads and the existing bundle budgets.

## Regression coverage and output parity

All 58 vendor variants are compared with their parents for capabilities, rendered
inspector controls, Request playback, admission and capacity analysis. Routing
variants exercise authored and empty tables after a stencil change. APISIX,
Apigee and Fastly Compute also exercise intermediate caller waits, in-flight calls,
successful replies and released capacity against a slow downstream service.

The icon build regression checks URL stability across adding and editing glyphs,
including a subpath base URL. Temporarily restoring the two original implementations
makes the regression suite fail. Every existing simulation golden stays unchanged.
Five goldens change only because the showcase's redundant empty simulations array
is removed:

- `node/skill/scripts/vendor-edge-storefront.json`: decoded share payload shrinks
  from 1,554 to 1,537 bytes, its SHA-256 changes, and the HTML payload omits the array.
- `node/exports/drawio/vendor-edge-storefront.drawio`: embedded diagram metadata
  omits the empty array; drawing geometry stays unchanged.
- `node/exports/drawio-meta/vendor-edge-storefront.json`: the corresponding
  with-icons XML fingerprint and byte counts change.
- `node/exports/html/vendor-edge-storefront.light.json` and
  `node/exports/html/vendor-edge-storefront.dark.json`: HTML file fingerprints and
  byte counts reflect the removed empty array.

No simulation behavior changes, and no new golden is introduced.

## Scope

Uses the existing parent contracts and inspector sections. No vendor-specific
routing implementation, control, quota claim or new simulation feature is needed.
The existing public vendor showcase remains the catalogue example.
Its redundant empty simulations array is removed so the existing share-link
round-trip test preserves the authored file exactly, as it does for other examples.
