## Extract the pool cohort lifecycle (PR #316, R-e4f3aa3e97)

Follow up with a focused `src/sim/poolCohort.ts` module exposing explicit grant, reply, failure and expiry transitions. Return ordered effects for the engine to apply; keep caller settlement and ledger operations with their existing owners.

Preserve the ordering constraints: mark an orphan's branch replied before releasing capacity, since release can synchronously dispatch another wave; remove cohort map membership before cancelling its deadline. Cover orphan and cancellation transitions directly and retain the integration regressions. This extraction is deferred from fix round 1 to keep the correctness repair narrow.
