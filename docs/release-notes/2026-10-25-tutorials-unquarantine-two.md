## Tutorials: rate limits and queue backlog

Released `rate-limit` and `backlog-lag`, and split the shared-budget example into its own
`shared-api-quotas` lesson. The inline lesson now teaches editing Rate limit in the Inspector.
The queue starts without a reader so Trouble offers Add a consumer; its final check requires
real processing in the rebuilt run and a bounded backlog, rather than comparing counters across restarts.
Dispatch remains in PR #331. No runner or bundle-budget changes.

The only changed parity golden is `node/i18n/catalogs.json`: 27 new English lesson messages and
four revised backlog messages change catalog counts, fallback counts and hashes. All other i18n
goldens remain unchanged. The skill viewer is refreshed by the required regeneration command.
