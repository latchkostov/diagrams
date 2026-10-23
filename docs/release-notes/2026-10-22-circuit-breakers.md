## Circuit breakers and retry-storm recovery

Request connections in `p3-w2` can fail fast with a circuit breaker. Closed breakers count settled
attempts in real units; open breakers return a local 503 without taking a pool connection or retrying.
After the open interval, a bounded half-open probe gate tests recovery. Breakers are shared across
the connection's caller replicas. Defaults follow resilience4j, shortened for short demonstrations.
Ignored routing refusals and cancelled calls consume their probe slot but never dilute the failure
rate. A batch with no health evidence is inconclusive and waits another open interval before testing.

The connection Inspector and Simulation context menu provide On/Off. Details stay folded away.
A saved simulation can explicitly override a diagram breaker with `caller.breaker: null` (Off),
just as `deadlineMs: null` overrides a diagram timeout. The Inspector labels the diagram's original
value. Open and Testing use the existing call pill; the Calls hover and status events explain them.

Retry storms take priority over downstream thread symptoms. A same-seed, bounded replay tries
jitter, a retry budget, a breaker, then two attempts; each candidate includes earlier steps.
The callout discloses those combined changes and offers only a confirmed recovery, undoable once.
An incomplete, refused or over-budget replay offers Events instead. Shedding remains for PR 3.
Run-end lessons distinguish a continuing storm from recovery.

The public **A retry storm** adds **A circuit breaker**. Payments retains 48 threads and the run
lasts 60 seconds. Across seeds 1, 7, 17, 42 and 99, the breaker opens at 5.1–5.5 s, initially
tests too early and reopens, then recovers at 18.0–18.4 s. Peak backlog is 650–710; final goodput
is at least 270/s and backlog below 100. These measured timings replace the design's provisional
4.3/9.3/9.5 s targets; the original three simulations keep their outcomes.

Trouble detection and its messages load separately from Live. A failed download keeps a Retry
action in the existing callout area through unrelated export notifications, with keyboard focus
returned on recovery. Breaker fields, pill formatting and run-end wording remain in their existing
optional chunks. Bundle budgets are unchanged. The skill uses compact machine JSON and a shorter
output guide retaining its access, encryption and export contracts to stay below 835,000 B.

## Intentional parity changes

Four new goldens record the new simulation:

- `node/sim/retry-storm/circuit-breaker.json`: breaker transitions, fast failures, probes and recovery.
- `node/trace/retry-storm/circuit-breaker.json`, `circuit-breaker.mmd` and
  `circuit-breaker.dead-letter.json`: its traced journey and dead-letter selection.

The following existing goldens change only for the stated additions:

- `node/agent/tools.json`: accepts the breaker object or explicit null in caller schemas.
- `node/agent/describe/retry-storm.json`, `node/agent/check/retry-storm.json`,
  `node/agent/edit/retry-storm.json`: a fourth saved simulation and its results.
- `node/planning/retry-storm.json`, `node/planning-p2/retry-storm.json`: the fourth simulation's
  scale suggestion and per-simulation planning data.
- `node/evidence/retry-storm.json`: the additional run's observed losses, expectations and evidence.
- `node/exports/native/retry-storm.diagram.json`, `node/exports/drawio/retry-storm.drawio`,
  `node/exports/drawio-meta/retry-storm.json`, `node/exports/html/retry-storm.light.json`,
  `node/exports/html/retry-storm.dark.json`: the exported diagram includes the new saved simulation;
  payload sizes and fingerprints follow it.
- `node/skill/public-schemas.json`: regenerated schema sizes and fingerprints for caller breakers.
- `node/skill/files.json`: compact generated spec, refreshed validator and shortened output guide.
- `node/skill/validate/retry-storm.txt`: fourth-run count and scale warning.
- `node/skill/scripts/retry-storm.json`: the new simulation in the HTML payload and share-link digest.
- `node/i18n/catalogs.json`: new breaker, storm, fix-disclosure and download-recovery messages.

Every other existing golden, including every frozen `w2-*` and browser golden, stays unchanged.
