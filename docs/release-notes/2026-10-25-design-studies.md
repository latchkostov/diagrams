## Design studies: checkout and payments

Adds two milestone-based design studies to the existing Design studies track: checkout at tenfold
traffic and safe payments. Each starts with a small invented diagram, offers a hint on demand,
applies a reference change on Skip, and finishes with a link to its public reference design.
Targets appear only after Show me, using the existing study runner contract.

Checkout covers capacity, an outbox event path and pacing calls to a payment partner. Payments
covers an outbox and idempotency declaration, a timeout and breaker during a PSP brownout, and
poison disputes reaching a dead-letter queue. The text distinguishes modeled contracts from
transactional writes and deduplication that a real implementation must provide.

The dispatch study's dinner-rush and partition-fix milestones are authored but quarantined:
owner decision pending: 7 (study-dispatch cross-run baseline). The two-run comparison is pending.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: the new English study messages
increase catalog message counts and English fallbacks and change the tutorials-area hashes.
Every other namespace hash and output golden is unchanged. Existing public reference examples are reused.
