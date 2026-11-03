## Cache checkpoint and restore audit, PR 427 round 2

The cache activation path adds no controls or text. Rewinding must reproduce the same reply
particles and failure markers as the original prefix; classification now travels in the
checkpoint clock alongside the restored graph.

Reviewed every mutation in `initializeCall`, `compileCaches` and cache property patches:

- Node `cache`, `waits`, `frees` and processor target `callTarget` are in the cloned graph.
- Edge retry policy/window/stream, breaker policy/state and call counters are in that graph.
- The global `classifies` flag now has an explicit clock slot, including queue-patch changes.
- Rule configuration and popularity remain shared immutable configuration. Rule streams,
  tracking counts, statistical freshness, expiry/fetch arrays, rate buckets and timestamps,
  fetch samples/cursor/count/sum/planned value, counters and optional warm-up time are packed
  losslessly and restored. Mutable payload bytes are fully charged, including object overhead.
- In-flight work lookup state (`rule`, item, outcome, time, expiry and fetching marker), calls,
  attempts, queues, ledger reservations, trips, logical events and random state retain their
  existing graph/clock capture. Packing preserves work-to-rule aliases and repeated restores
  allocate independent arrays and counters.
- Raw and resolved props are captured; the configuration readout is invalidated on restore.
  Admission indexes and consumer/fault-edge indexes are rebuilt from the restored graph.
- Cache runtime identity is immutable executable code. Caller settings, starting cache rates,
  planning revision and topology remain load-scoped inputs; activation never mutates them.
  The remaining tracked-item allowance is recomputed from the restored nodes on each patch.

Regressions cover inactive, active, replaced and disabled caches with work in flight, capability
flags, retries and breakers; replay across timeline activation compares every prefix snapshot,
including reply particles, twice. Codec coverage checks sparse/dense arrays, fractional values,
negative zero, optional warm-up state and independent repeated restores.

Rejected raising the 130 KiB bound, excluding mutable payloads from accounting, float32 rounding,
and changing simulation behavior to fit storage. The compact checkpoint representation changes
storage only. No new public example is needed for these internal replay and memory fixes.
