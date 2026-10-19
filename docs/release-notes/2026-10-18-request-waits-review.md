## Requests that wait: review corrections

W1 diagrams retain their planning revision, request routes, resource settings and saved simulations through
draw.io export and import. Revision capability checks now share one model rule. Planning and playback also
share which nodes can make blocking calls: terminals and brokers cannot introduce fictitious caller waits.

Capacity estimates share resolved work and hold durations, including endpoint overrides. Thread slots and
memory stay occupied while a caller waits; CPU counts executing work. Every admission and resource lane now
uses the same residence time. Request concurrency scalers include held calls, and broker-held calls no longer
hide queued pushed requests from scaler metrics.

Sampled caller pools refine their dot weight to fit whole dots within their limits, including pools smaller
than the requested dot weight. Admission checks the complete next dot before reserving it. Saved and manual
real-count injections use the effective weight, and fractional weights remain visible in sampling labels.
Fixed execution meters show the effective execution pool. An unknown pool has accessible descriptive text
without a numeric meter, empty bar or infinite ceiling formula.

Sampled resource admission reads held work lazily, only when cohort compaction or splitting needs its owners.
Invisible animation echoes retain aggregated expiry counts rather than message graphs; active-edge counts
and checkpoint replay remain exact. Emission mappings use own-property lookup for inherited property names.

### Deliberate golden changes

Only W1 diagram outputs and the shared text catalog change. Earlier revisions' diagram goldens are unchanged.

- `node/exports/drawio/` and `node/exports/drawio-meta/`: both files for each of `blocking-call`,
  `corpus-w1-blocking`, `corpus-w1-gateway`, `corpus-w1-held-drain`, `corpus-w1-join-failure`,
  `corpus-w1-loop` and `corpus-w1-sampling`. The XML now carries W1 planning metadata; read-back metadata
  retains the revision and its fields, and the recorded XML fingerprints change with those bytes.
- `node/planning/blocking-call.json` and `node/planning/corpus-w1-held-drain.json`: per-replica, initial and
  maximum resource capacities use hold time rather than work alone.
- `node/agent/describe/blocking-call.json` and `node/agent/describe/corpus-w1-held-drain.json`: agents receive
  those same corrected resource estimates and explanation text.
- `node/sim/blocking-call/free-play.json`: effective sampling changes from 10 to 8 real requests per dot to
  fit the caller's thread pools. The recorded counts, concurrency pressure and resulting run follow that weight.
- `node/i18n/catalogs.json`: one unknown-capacity message and the explanation of effective caller sampling
  update the catalog fingerprint; existing translations keep their normal English fallback.

### Verification

Removing the fixes reproduced 22 failing regression cases spanning all eight issues and the meter readout.
Restoring the fixes passes the focused regressions. The existing startup chunk assertions are preserved;
the small revision helper is bundled into the existing native model chunk. No capacity assertion, performance
bound or historical golden was weakened to accommodate a failure.

The restored focused run passes 341 tests. Parity regeneration passes 1,571 Node tests and 93 Linux browser
tests, with the 20 deliberate changes listed above and no added, missing or removed goldens. The production
entry is 108.9 kB gzip against its unchanged 123.5 kB budget. The requested Linux load repetitions could not
start because the shared gate budget was occupied (exit 75); they remain for CI under the verification budget.
