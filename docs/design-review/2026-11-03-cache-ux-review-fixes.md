## Cache UX follow-up, review round 1

The existing readout and export surfaces retain their controls and disclosure structure. Counts now
describe only evidence available at that scope: per-rule configured destinations are separate from
aggregate requests, and multi-destination offload does not promise savings at each service. Fetches
means actual fetches rather than all misses. Duplicate display names never join model entities.

Legacy export places behavioural losses before Technical details for all applicable model revisions;
only implementation details collapse. No new toolbar, menu or inspector controls are added.

Regressions cover Black Friday's default routing, exact coalesced fetch/offload rates, duplicate CDN
names, all seven model revisions, linear label indexing and reuse across counter-only publications.
Mutation checks restore the old projections or replace fetch/offload arithmetic and confirm failures.
