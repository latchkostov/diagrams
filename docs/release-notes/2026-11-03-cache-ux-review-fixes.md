## Caching readout and export corrections (#432, review round 1)

Cache details resolves each rule's configured destinations through its applicable request routes,
route-table action and eligible request connections. Black Friday's Order status lists API gateway
only. Rule request counts stay aggregate and no longer claim completed deliveries. With several
destinations, requests kept away uses neutral aggregate wording rather than naming every service.

Fetches now uses actual window fetches, including when One fetch per item shares a fetch across
misses. Offload remains requests minus fetches, including coalesced requests. Node labels and
destinations are indexed and memoized outside counter-only Live updates.

Caching upgrade consequences preserve node IDs, so equal CDN names cannot include unrelated services.
Legacy export keeps applicable retries, circuit breakers, queue limits, request waits and cache-rule
losses visible before download; technical field paths remain collapsed. Arabic copy follows the
readout changes and isolates names and rates.

Only `node/i18n/catalogs.json` changes: the English and Arabic cache-message hashes, message totals,
fallback totals and completeness hashes reflect the new aggregate offload message and corrected
destination/fetch wording. Contract records remain unchanged. No diagram, simulation or engine output
goldens change.
