## Caching lesson and Arabic fixes

Missing purge rules now explain the repair in Arabic, with isolated step numbers and rule names. Every English key added by P2-A has a current Arabic translation. Shorter Arabic cache explanations preserve the existing locale budget: 97,495 B gzip of 97,500 B; core is 37,703 B of 38,000 B. The existing T35 headroom follow-up remains necessary.

The cache lesson keeps its short recap. T10.05's Drill authoring route and example comparisons now appear in the scrollable reading region, where the complete text remains visible on shorter screens. Other lessons keep their existing layout.

## Output parity

Only `node/i18n/catalogs.json` changes in this fix round. The separate guidance message adds one lookup to each catalog and an English fallback outside Arabic; Arabic also translates the previously missing purge-rule message. The restored recap and concise Arabic cache wording update the tutorial and cache fingerprints. The other two scoped i18n goldens are unchanged. No simulation quantities or example workloads change.
