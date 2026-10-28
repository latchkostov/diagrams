## Catalog integration review

This compiler bookkeeping fix preserves catalog ownership, translated text, download boundaries,
loading behavior and controls. Standalone pages retain their scoped catalogs. No new example or
chrome is needed. Reassigning tutorial copy to core would spend startup bytes without addressing
the missing numeric-key metadata; changing the standalone assertion would leave that inconsistency.
