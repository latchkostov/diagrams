## Waiting tutorials: pending owner decisions

- `backlog-lag`: owner decision pending: 8 (Build 07, backlog-lag Add a consumer). Live and backlog >= 50
  are authored against the seeded inline queue. The slow-reader Trouble offers Inputs; Add a consumer is
  offered only with no reader (`src/live/observedTrouble.ts`). Adding a consumer also restarts Live
  (`src/live/session/useLiveFixes.ts`), so `sinceStep` cannot compare the old backlog falling across that
  restart. A specific test id alone does not make these last two steps playable. Decide the intended action
  and observation before adding those steps. No runner or simulation changes were made in this lane.
- `scale-to-zero`: owner decision pending: 3 (Build 07, cold start). Quiet Sunday, zero replicas and Morning
  rush are authored. No cold-start counter exists. Decide whether `fleet.starting >= 1` is the intended
  observation or wait for a simulation counter, then add the final moment and remove quarantine.

Both ids remain registered for catalog lint and the generated solution/Skip-all tests. Quarantine keeps
them out of discovery, deep links and completion totals until the decisions are resolved.
