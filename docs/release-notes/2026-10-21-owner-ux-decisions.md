## Payment lessons and fixes that say where they land

“A slow payment provider” now tells one four-part story: no timeout, a 600 ms timeout,
forty connections with threads freed, then the same pool with threads held. Every run
includes the order-status route. The former pool card is retired; its canvas, embed and
saved-simulation links resolve to the matching story, using the existing retirement and
local-edit preservation path.

Callout fixes create an override in the selected saved simulation even when it previously
inherited the diagram's settings. The toast names that simulation and offers Undo.
The callout reuses the planner's verified scaling adjustment before introducing timeout
failures or changing call semantics. Deadline and non-blocking alternatives also need a
same-seed rerun that reduces both queued work and held threads. Verification runs in the
checks worker with a work bound; no confirmed remedy means Show events.

Red node badges count dropped and dead-lettered messages once. The hover has one outcome
line for losses, timeouts and late replies; failed attempts appear only when their count
differs. Simulation engine counters are unchanged. The new copy includes Arabic and the
generated pseudo-locale, and the skill viewer is regenerated without a version change.

## Output parity

The merged example adds the two pool simulations without changing the existing runs.
Its exports, descriptions, evidence and per-simulation planning metadata reflect four
stories. Both moved simulation goldens are byte-for-byte identical as JSON to their
former paths; the existing no-timeout, timeout and free-play simulation goldens are
unchanged. All six moved trace goldens are identical too. Obsolete pool-example goldens are removed.

Two shared derived records also change: `node/i18n/catalogs.json` records five new
localized messages, the expanded payment-card summary, Arabic translations and the
pseudo-locale; `node/skill/current-stencils.json` fingerprints the regenerated frequency
list after removing a duplicate example. Frozen-corpus, engine-counter, route, layout
and renderer goldens stay unchanged. Bundle budgets and plugin versions are unchanged.

Exact inventory below, relative to `tests/parity/goldens/`: M = modified, A = added at
the merged example's path, D = retired. Each slow-payment export/agent/evidence/skill
record includes the four stories; its planning records add the two simulation IDs.
The eight added simulation/trace records cover those same two moved stories.

```text
D browser/layout/pool-of-40.json
D browser/render/pool-of-40.json
D node/agent/check/pool-of-40.json
M node/agent/check/slow-payment-provider.json
D node/agent/describe/pool-of-40.json
M node/agent/describe/slow-payment-provider.json
D node/agent/edit/pool-of-40.json
M node/agent/edit/slow-payment-provider.json
D node/checks-words/pool-of-40.json
D node/checks/pool-of-40.json
D node/evidence/pool-of-40.json
M node/evidence/slow-payment-provider.json
D node/exports/drawio-meta/pool-of-40.json
M node/exports/drawio-meta/slow-payment-provider.json
D node/exports/drawio/pool-of-40.drawio
M node/exports/drawio/slow-payment-provider.drawio
D node/exports/html/pool-of-40.dark.html
D node/exports/html/pool-of-40.dark.json
D node/exports/html/pool-of-40.light.html
D node/exports/html/pool-of-40.light.json
M node/exports/html/slow-payment-provider.dark.json
M node/exports/html/slow-payment-provider.light.json
D node/exports/mermaid-plain/pool-of-40.mmd
D node/exports/mermaid-read/pool-of-40.json
D node/exports/mermaid/pool-of-40.mmd
M node/exports/mermaid/slow-payment-provider.mmd
D node/exports/native-meta/pool-of-40.json
D node/exports/native/pool-of-40.diagram.json
M node/exports/native/slow-payment-provider.diagram.json
M node/i18n/catalogs.json
D node/layout/pool-of-40.json
D node/planning-p2/pool-of-40.json
M node/planning-p2/slow-payment-provider.json
D node/planning/pool-of-40.json
M node/planning/slow-payment-provider.json
D node/routes/pool-of-40.json
D node/sim/pool-of-40/blocking-pool.json
D node/sim/pool-of-40/free-play.json
D node/sim/pool-of-40/pool-40.json
A node/sim/slow-payment-provider/blocking-pool.json
A node/sim/slow-payment-provider/pool-40.json
M node/skill/current-stencils.json
D node/skill/scripts/pool-of-40.json
M node/skill/scripts/slow-payment-provider.json
D node/skill/validate/pool-of-40.txt
M node/skill/validate/slow-payment-provider.txt
D node/trace/pool-of-40/blocking-pool.dead-letter.json
D node/trace/pool-of-40/blocking-pool.json
D node/trace/pool-of-40/blocking-pool.mmd
D node/trace/pool-of-40/free-play.json
D node/trace/pool-of-40/free-play.mmd
D node/trace/pool-of-40/pool-40.dead-letter.json
D node/trace/pool-of-40/pool-40.json
D node/trace/pool-of-40/pool-40.mmd
A node/trace/slow-payment-provider/blocking-pool.dead-letter.json
A node/trace/slow-payment-provider/blocking-pool.json
A node/trace/slow-payment-provider/blocking-pool.mmd
A node/trace/slow-payment-provider/pool-40.dead-letter.json
A node/trace/slow-payment-provider/pool-40.json
A node/trace/slow-payment-provider/pool-40.mmd
```
