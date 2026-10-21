## Engine R4 review fixes

CPU tails keep an explicit delivery group alongside their replica and CPU parts. Kafka consumers
retain draining partitions until that CPU ends, including after the thread reservation releases.
Drain-grace expiry cancels remaining CPU before settling work; the CPU oracle rejects ownerless tails
and accepts idle, unbounded-CPU fleets at zero replicas.

Admission uses live execution reservations, including reservations created before a policy was added.
A newly capped caller queues behind an existing blocking request without charging its quotas or
throwing. Resource-backed W1 processors outside the call graph reserve sampled execution capacity too,
so returning from scale ten to scale one admits one request at a time at concurrency one. Numeric
execution outside the ledger continues contributing its own occupied slots. Pre-W1 execution keeps
its existing admission and completion behavior. Standalone retries keep their admission leases on
the existing retry path while the ledger owns execution, avoiding a second charge of the same keys.

Request reservations now supply the memory aggregate, including queued reply continuations and
retained residence. Ten resident requests with a 128 MiB baseline and 2 MiB per request report
148 MiB rather than 130 MiB. A request and its independent thread tail count once; retiring a thread
or changing the sampling scale does not invent another resident request.

Shared diagnostic limits aggregate once per configuration batch. Sampled admission stops reading
fragmented ready ranges after finding eligible capacity. Recovery discards removed admission keys,
and the outage matrix now requires all six injected deliveries to reach the result with the expected
attempt failures and no drops. The existing shared-cap recovery test already isolates the account cap
from the unchanged node, endpoint and execution caps.

## Output parity

No goldens change. All pre-W1, scale-one W1, sampled W1, browser and non-simulation outputs remain
identical. The corrected memory regressions had asserted thread-plus-request double counting; they
now independently check the live request reservation and its memory integration.

## Regression proof

The five named review regressions fail against the original R4 source and pass with these fixes.
The two R3 runtime bugs also reproduce with the origin/master engine sources. Operation-count tests
fail without batched shared-limit aggregation and bounded ready-range counting; recovery coverage
fails when removed admission keys are restored. Additional coverage checks live sampled owners across
a return to scale one, ownerless-tail detection and the legacy ownership boundary found by A1 seed 151.
