## Live health reflects current conditions

Needs attention now uses one shared Live health policy: failures, timeouts, losses and refusals observed in the last 10 seconds of simulation time, current runtime state, or sustained queue growth. History samples once per simulated second; growth must span the window, keep rising recently and exceed the larger of 10 messages, three sampled dots or 20% of the starting queue. Existing recent retry pressure still requires at least 1.2 attempts per request and 10 retries. Pausing preserves the window; restarting resets it; seeking restores its checkpoint history.

Small stable queues are neutral, including the reviewed 300/s service with five messages waiting and five of 400 threads busy. Recovered connections say **Closed · calls succeeding** after recent failures expire and successful calls are observed. Open and testing breakers still need attention. Cards, Inspector Live, node loss badges, connection pills, queue growth, trouble callouts and their announcements use the shared policy. Past counts and the settled-attempt failure percentage remain available in **Outcomes**, labelled **Since restart**.

Each of A retry storm's four saved simulations now says what to watch at 1.2 seconds: quick retries, jitter, the retry budget or the breaker. The cards describe the actual slowdown at 3 seconds lasting five seconds. All four runs retain their authored 60-second duration and other event times; POST repetition warnings stay in the retry comparisons.

## Golden inventory

All paths below are relative to `tests/parity/goldens/`. Only authored narration, its serialized representations and the English health messages change; simulation counters, timing, checks and geometry are unchanged.

| Golden                                          | Reason                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `node/sim/retry-storm/three-quick-retries.json` | Early quick-retry note and its timeline marker text.                                      |
| `node/sim/retry-storm/jittered-backoff.json`    | Early jitter note and its timeline marker text.                                           |
| `node/sim/retry-storm/retry-budget.json`        | Early budget note and its timeline marker text.                                           |
| `node/sim/retry-storm/circuit-breaker.json`     | Early breaker note and its timeline marker text.                                          |
| `node/skill/scripts/retry-storm.json`           | Share-link payload fingerprint/bytes and exported HTML payload include the new notes.     |
| `node/agent/describe/retry-storm.json`          | Agent descriptions and diagram fingerprint include the new narration.                     |
| `node/agent/edit/retry-storm.json`              | Agent round-trip retains the four new narration texts.                                    |
| `node/i18n/catalogs.json`                       | Seven new English health/scope/Lab messages and associated catalog/fallback fingerprints. |
| `node/exports/native/retry-storm.diagram.json`  | Native export serializes the updated narration.                                           |
| `node/exports/drawio/retry-storm.drawio`        | Embedded native diagram metadata retains the updated narration.                           |
| `node/exports/drawio-meta/retry-storm.json`     | Draw.io metadata round-trip and fingerprints reflect the notes.                           |
| `node/exports/html/retry-storm.light.json`      | Light HTML payload and file fingerprint/bytes reflect the notes.                          |
| `node/exports/html/retry-storm.dark.json`       | Dark HTML payload and file fingerprint/bytes reflect the breaker note.                    |

## Verification and bundle limits

Regression tests cover current failure, recovery, stable and growing queues, pause/restart/seek, the reviewed browser cases, early narration in every comparison, and light/dark hover-card axe scans. Reinstating the old health behavior fails four new regressions; reinstating the old narration fails the early-guidance test. The checkpoint regression and stable-queue canvas glow regression were also observed failing before their fixes. Production build, entry/viewer size checks and English catalog validation pass. Final gate results are reported on the PR.

| Gzip download     |  Bytes | Fixed budget | Headroom |
| ----------------- | -----: | -----------: | -------: |
| Entry             | 107634 |       123500 |    15866 |
| Startup           | 173159 |       177000 |     3841 |
| Canvas first view | 380959 |       383000 |     2041 |
| Live session      | 126334 |       135000 |     8666 |

Existing startup/canvas trim work remains tracked in `docs/backlog/2026-10-24-p2-performance.md` (P-05). No budget was increased. Generated skill assets are refreshed without changing plugin versions.
