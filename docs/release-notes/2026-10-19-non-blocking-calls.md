## Free the thread while waiting

Request connections in the `p3-w1` model can now hold or free the caller's thread. Services and
functions hold by default; gateway, proxy and workflow families free it. Choose **While waiting**
in the connection's Simulation inspector or use **Simulation > Free the thread while waiting**
on its right-click menu. Reply handling and an optional connection cap live in Advanced.

A freed call retains its memory, but only work and reply handling occupy a thread. Replies run
ahead of new work and charge 10% of the normal CPU work per reply. Planner capacity uses the same
mode/default contract as playback and accounts for continuations and caps. Sampled reservations
use the shared caller-occupancy contract, including a cap smaller than a dot.

Live shows calls in flight on the meter and connection pill. A growing queue with exhausted
waiting threads offers one undoable **Free the thread while waiting** fix. The warning survives
brief reply/admission gaps. Latency separates queued time from call time and sources record
response times. Saved simulations can override connection caller policies in `setup.edges`.
Renaming an emitted message preserves its completed call-wait and continuation timings, so
downstream latency keeps the same queued/work/call split as the caller.

The public **A blocking call caps throughput** example now includes **Free the thread while
waiting**: calls wait off-thread within ten seconds; the 15-second traffic spike later makes CPU
scaling add replicas. Deadlines, blocking connection pools, busy-thread scaling and new Checks
remain for the later PRs.

## Output parity

The update records 2,712 goldens: **19 changed, 40 added, none missing or removed**. Every older
revision's diagram output, every existing W1 corpus output and every browser golden is unchanged.
The changed goldens are exactly:

| Golden paths under `tests/parity/goldens/`                                                                                                                                                                                                                                       | Reason                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node/agent/tools.json`                                                                                                                                                                                                                                                          | Caller wait/reply policy and saved connection-override schemas.                                                                                                            |
| `node/skill/public-schemas.json`                                                                                                                                                                                                                                                 | Fingerprints of those regenerated diagram/operation contracts.                                                                                                             |
| `node/skill/files.json`                                                                                                                                                                                                                                                          | The generated skill specification carries the caller fields.                                                                                                               |
| `node/i18n/catalogs.json`                                                                                                                                                                                                                                                        | English controls/readouts and their fallback catalog fingerprints.                                                                                                         |
| `node/skill/validate.txt`                                                                                                                                                                                                                                                        | The two new frozen W1 corpus diagrams validate.                                                                                                                            |
| `node/exports/native/blocking-call.diagram.json`, `node/exports/drawio/blocking-call.drawio`, `node/exports/drawio-meta/blocking-call.json`, `node/exports/mermaid/blocking-call.mmd`, `node/exports/html/blocking-call.light.json`, `node/exports/html/blocking-call.dark.json` | The example's new description and second saved simulation round-trip through exports; metadata-bearing exports and their hashes include it. Drawing geometry is unchanged. |
| `node/planning/blocking-call.json`, `node/planning-p2/blocking-call.json`                                                                                                                                                                                                        | Planning additionally evaluates the new saved simulation; its connection override executes only in W1.                                                                     |
| `node/agent/check/blocking-call.json`, `node/agent/describe/blocking-call.json`, `node/agent/edit/blocking-call.json`, `node/evidence/blocking-call.json`                                                                                                                        | The example has two simulations to describe, replay and report.                                                                                                            |
| `node/skill/scripts/blocking-call.json`, `node/skill/validate/blocking-call.txt`                                                                                                                                                                                                 | The share/export payload includes the second simulation; validation reports two simulations.                                                                               |

The 40 additions cover the non-blocking and capped W1 fixtures across simulation, waits, planning,
checks, evidence, agents, layout/routes and exports, plus the public simulation and its traces.
No existing simulation golden was changed to accommodate a failure.

## Validation and download budgets

The focused engine, sampling, planner, round-trip, example, trouble and latency run passes 360
tests. The renamed-output regression fails without timing propagation and passes with it; a source
response test waits for continuation completion and excludes animation travel. Production browser
tests cover the toggle, meter, pill, continuation ceiling and one-step callout undo.

No bundle budget is raised. Caller-family records remain shared; advanced/custom property editors,
waiting visuals and secondary Live panels load on demand. The startup chunk contract continues to
guard these boundaries.
