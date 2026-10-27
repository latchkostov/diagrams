## Readable identity in every canvas view

Presentation, link and host embeds, and the Interactive HTML viewer now share the editor's measured
title fitting and icon sizing. Narrow titles retain a meaningful prefix or initial; their tooltip and
stored name keep the full label. Camera cropping and Overview controls remain editor features.

Imported titles use cached binary search over a bounded display prefix, avoiding thousands of font
measurements for a long name. Overview headers truncate oversized words inside their measured width,
and skip the outside placement search when an internal header band is already clear.

Regression coverage checks the 10,000-character measurement bound, narrow headers beside other cards,
presentation and read-only title fitting, and the complete delivery-dispatch node set at both zooms.

These rendering fixes leave visual goldens unchanged. Syncing with master refreshes only
`node/i18n/catalogs.json`: its message counts, fallbacks and namespace hashes include the upstream
renamed zoom-control messages and two new Live rail hints alongside this branch's camera message.
