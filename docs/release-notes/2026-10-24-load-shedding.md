## Load shedding

W2 processors can bound pushed waiting requests with `props.queue`: limit, reject new or drop oldest,
FIFO or LIFO, and lazy maximum wait. Incoming connections have critical, normal or sheddable priority.
Active work, continuations, managed admission and broker deliveries keep their existing ownership.
Queue refusals return 503 in the throttled class and count as rejected and shed. Unanswered pushed
messages also count as lost in simulation evidence.

Queue fields stay in the lazy inspector’s advanced disclosure. The existing Live strip shows an
⤓ cumulative shed total, with the actual pushed queue count against its limit. Hover explains the
503s since restart. Historical sheds do not create a current health verdict; current shed-rate
attention has a seam for the shared health window. No new global controls or particle shapes.

The fix ladder adds shedding after the breaker, retains it before reducing attempts, and offers
only the first same-seed replay proven to recover. The queue preset fits the caller’s deadline.
The public “A retry storm” example gains “Shed load at Payments”: limit 60, newest first, 200 ms.
Across five seeds, its queue stays at or below 60; raw recovery starts after the 8 s clear and the
smoothed goodput reaches 270/s at about 10.5 s. All end expectations pass.

## Golden inventory

All paths below are under `tests/parity/goldens/node/`. Nineteen existing records intentionally
change; four new records cover shedding. No existing simulation or browser golden changes.

| Record(s)                                                                               | Reason                                                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sim/retry-storm/shed-load.json` (new)                                                  | End expectations, queue cap, shed/rejected counters, throughput, full event hashes and latency for the new saved simulation.                 |
| `trace/retry-storm/shed-load.json`, `shed-load.mmd`, `shed-load.dead-letter.json` (new) | Its traced journey, sequence text and absence of broker dead letters.                                                                        |
| `agent/describe/retry-storm.json`                                                       | The public example now lists five simulations.                                                                                               |
| `agent/check/retry-storm.json`                                                          | Evidence reports five played simulations. No check rules change.                                                                             |
| `agent/edit/retry-storm.json`                                                           | Edits preserve the added queue simulation.                                                                                                   |
| `evidence/retry-storm.json`                                                             | The fifth run’s losses and unread Orders evidence.                                                                                           |
| `exports/native/retry-storm.diagram.json`                                               | Native serialization includes simulation five.                                                                                               |
| `exports/drawio/retry-storm.drawio`, `exports/drawio-meta/retry-storm.json`             | Embedded diagram payload and fingerprints include simulation five.                                                                           |
| `exports/html/retry-storm.light.json`, `exports/html/retry-storm.dark.json`             | Both themes’ embedded payloads and fingerprints include simulation five.                                                                     |
| `planning/retry-storm.json`, `planning-p2/retry-storm.json`                             | Add the fifth simulation’s capacity, scale suggestion and compatibility views. Existing runs stay unchanged.                                 |
| `skill/scripts/retry-storm.json`                                                        | Share-link and exported-HTML payloads retain simulation five.                                                                                |
| `skill/validate/retry-storm.txt`                                                        | Reports five simulations and the new run’s existing pinned-scale warning.                                                                    |
| `agent/tools.json`                                                                      | The shared edit schema accepts bounded queue fields and connection priority. Agent analysis additions remain deferred to PR 4.               |
| `skill/public-schemas.json`, `skill/corpus-hand-shaped-lines.public-schemas.json`       | Shared schema fingerprints reflect queue/priority validation.                                                                                |
| `skill/files.json`, `skill/corpus-hand-shaped-lines.files.json`                         | Required regenerated format reference/spec fingerprints reflect the new fields.                                                              |
| `i18n/catalogs.json`                                                                    | 21 English keys for queue controls, priority, shed counters and the proven ladder action; other languages use the existing English fallback. |

The schema/skill fingerprints are necessary consequences of PR 3’s shared public model contract,
not additional analysis features. The parity recorder now observes test events directly: a lazy
stale-queue flush can exceed the UI’s 200-event ring in one tick. The lossless test-only observer
leaves that shipped ring bounded and preserves every previous simulation hash.

## Verification

Focused engine, ladder, hover and evidence tests pass. Disabling queue resolution deliberately
fails the scale-2 and scale-10 queue-limit regressions, and restoring it passes. Build and fixed
entry, viewer and Forge bundle budgets pass. The required 44-seed engine sweep and browser
verification are in progress; this is a WIP checkpoint.
