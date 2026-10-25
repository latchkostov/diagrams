## Tutorial observation fixes

The rate-limit lesson now waits for the Rate Limiter readout before completing its rejection observation.
The backlog lesson follows the consumer created by Add a consumer even when an unrelated service already exists.
The observation and binding fixes do not change output goldens. Sync regenerated only
`node/i18n/catalogs.json`, combining this branch's existing 27 new English lesson messages and four
revised backlog messages with upstream case-study copy. Catalog counts, fallback counts and tutorial
hashes reflect that combined copy; the other i18n goldens remain unchanged.
