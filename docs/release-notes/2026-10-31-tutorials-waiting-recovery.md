## Diagnose waiting and recover deliberately

Chapter IV adds **Scale workers for waiting jobs**, using the public Autoscaling basics
KEDA story: inspect the group lag signal, target and replica bounds, distinguish Starting
from Ready, find the three-partition ceiling, then raise partitions and verify a fresh
80-job burst. The original public example, policies, seeds and expectations are unchanged;
the focused practice and held readings are also available in the Lab.

Revise and version **Where the time goes**, **A blocking call holds threads**, **Timeouts
and connection pools**, **Scale on busy threads**, **Scale to zero**, **Backoff and a retry
budget**, **A circuit breaker** and **Dead letters**. The six retained waiting/resilience
lessons receive shared copy polish. Predictions, percentile sampling limits, Request
waiting, late provider work, controller units, warm capacity, retry comparisons and recovery
limits are explicit. Breaker narration holds real Open/Testing readings; Dead letters
investigates a real trace and verifies delivery 3 in a new run. DLQ replay remains unavailable.

Skip and Continue restore authored experiments through the existing Save/Run operations.
Checks match expectation meaning, including observation time, and typed observations read
existing caller counters and dead-letter trace attempts. Pointer and keyboard routes use
the same product controls; no simulation-engine algorithms, budgets or reserves change.

## Output parity

The only changed golden is `tests/parity/goldens/node/i18n/catalogs.json`: 120 new
messages increase all 38 catalog counts from 4,578 to 4,698. All 37 translated catalogs
gain 120 English fallbacks; the pseudo-locale gains none. Only tutorials fingerprints
change, including the pseudo-locale. No existing translation is stamped. No public
example, simulation, diagram, layout or export golden changes.
