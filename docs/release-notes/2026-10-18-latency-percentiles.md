## Sampled async latency in Live

Live now records p50, p95 and p99 from successful async message paths. A sink shows p95 in its existing
badge slot; other nodes show it with Show ▸ Capacity. Hover a consumer or store for the percentile strip,
the sampled-message count and waiting/work/travel shares. There is no new Live control.

Each family retains its birth time, and each branch retains its own work and animation travel totals.
Successful handling records the root-to-this-node duration, including every terminal consumer. Percentiles
exclude animation travel and never add per-hop percentiles. Request branches, failed attempts, refusals,
drops and unread broker storage are outside this success population. These are sampled completions since
restart, not an SLO, a physical-network estimate or a rolling window; unfinished messages are not included.
The breakdown aggregates the same sampled paths, including separately labelled animation travel.
Successful retries include their earlier failed work and backoff. Pausing an in-place retry keeps its
remaining backoff in waiting rather than relabelling it as work.

Histograms use 128 fixed logarithmic buckets, with upper-bound estimates within 12% through about 26 minutes;
longer overflow samples use their observed maximum. Each node keeps an aggregate and up to 64 type histograms.
Further types still enter the aggregate. Buckets and all path arithmetic travel in engine checkpoints, so
scrubbing, replay and slow-motion look-ahead restore the same readouts. Durations and sample counts are
never multiplied by the simulation's message scale. Expectation metrics and agent contracts remain PR 2.
Frame readouts are immutable and reused between arrivals, avoiding repeated type-map allocation while
the distribution is unchanged. A later arrival creates a new view without changing earlier frames.

The public **Where the time goes** example sends 2,000 orders/s through Kafka to Billing. At 4 s a
10,000 orders/s spike exceeds Billing's 2,400 orders/s capacity. By 9.4 s, Billing's p95 rises from 300 ms
to approximately 3.9 s and its hover reports **Waiting 78%**. A steady-traffic simulation provides the
comparison. Gallery metadata, evidence-backed Latency percentiles tagging, example tests and parity cover it.

### Output parity

The example adds its own simulation, checks, planning, agent description, export, layout and rendering
goldens, plus dedicated latency goldens for both simulations. The dedicated records include aggregate and
per-type percentiles and all breakdown totals every 200 simulated milliseconds. Existing simulation
counters, events and tracing output are unchanged. There are 38 new example goldens:

| Paths under `tests/parity/goldens/`                                                                                 | Count | Purpose                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----: | ---------------------------------------------------------------------- |
| `browser/{render,layout}/where-the-time-goes.json`                                                                  |     2 | Authored drawing, Auto-layout and Tidy.                                |
| `node/{planning,planning-p2}/where-the-time-goes.json`                                                              |     2 | Capacity and broker semantics.                                         |
| `node/skill/{validate/where-the-time-goes.txt,scripts/where-the-time-goes.json}`                                    |     2 | Offline validation and script exports.                                 |
| `node/{layout,routes}/where-the-time-goes.json`                                                                     |     2 | Headless layout and connection routing.                                |
| `node/{checks,checks-words,evidence}/where-the-time-goes.json`                                                      |     3 | Findings, wording and architectural evidence.                          |
| `node/latency/where-the-time-goes/{billing-spike,steady-orders}.json`                                               |     2 | Sampled aggregate and per-type distributions over time.                |
| `node/agent/{describe,check,edit}/where-the-time-goes.json`                                                         |     3 | Existing agent behavior on the new input, with no new agent metrics.   |
| `node/trace/where-the-time-goes/*`                                                                                  |     8 | Free-play and saved-run traces, sequences and absence of dead letters. |
| `node/sim/where-the-time-goes/{free-play,billing-spike,steady-orders}.json`                                         |     3 | Existing counters and event streams for both scenarios.                |
| `node/exports/{native,native-meta,drawio,drawio-meta,mermaid,mermaid-plain,mermaid-read,html}/where-the-time-goes*` |    11 | Native, draw.io, Mermaid and both Interactive HTML themes.             |

Exactly two existing goldens intentionally change: `node/i18n/catalogs.json` gains nine English messages,
their pseudo-locale forms and catalog fallback/hash bookkeeping; `node/skill/current-stencils.json` records
the generated popularity-list change caused by the example's public stencils. Every other existing golden
stays unchanged. The geometry unit snapshot adds only the new example's three connections.

The generated offline viewer includes the recorder and hover, so the skill zip budget grows deliberately
from 800 kB to 810 kB. The app's entry budget and startup-chunk contracts are unchanged. No plugin version
is changed.

### Verification

The focused recorder tests cover histogram/type bounds, root timing, travel separation, scaling, detached
views, fan-out, Request exclusion, retry/backoff, pausing, reset, checkpoint restore and seeded replay.
Disabling the recorder makes the regression fail. The paused-backoff test first reproduces the incorrect
work total, and restoring the old hover placement fails the no-overlap browser assertion. Browser coverage checks sampling copy, the default sink
badge, Capacity disclosure, seek replay, hover placement, Arabic and the pseudo-locale.

The load sweep exposed the existing pausing-note focus test doing two complete browser scenarios under
one hang backstop. Its trace completed both focus assertions before the overall timeout. Those variants
now run as separate tests with the same 1,500 ms virtual-clock advancement and all original assertions;
no timeout or camera assertion is relaxed.

Parity script transcripts now normalize their temporary directory before their checkout directory.
This preserves the existing `<tmp>` goldens when the gate keeps temporary files inside the repository,
on Windows and Linux. Regression tests cover both placements and path styles; no existing script-output
golden is changed to include a machine path or random directory name.
