## Engine reservation recovery and retry accounting

Outage recovery now reacquires caller capacity through queued admission before retained broker work runs. Logical work and checkpoints hold reservation ids; owner shutdown invalidates them together with ledger ownership. Retry admission renews request and execution keys atomically at their respective retained weights, including continuations after a live capacity decrease. Queued work on a down service fails through logical attempt accounting even at zero concurrency.

Regressions cover local-work and backoff outages at scales one and ten, both reviewed continuation-weight cases, a saved burst into a zero-concurrency service, and exact held occupancy plus independently blocked admission immediately after a four-to-one shrink. No tolerances, generators or goldens change; all scale-one outputs and the existing blocking-call golden remain unchanged.
