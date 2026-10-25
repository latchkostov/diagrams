## Simulation basics owner decisions

- Capacity: `owner decision pending: Bottleneck callout "open" step`. The callout appears
  automatically; there is no published open state. The lesson authors the supported capacity,
  backlog, Apply fix and recovery steps and remains quarantined.
- Trace in slow motion: `owner decision pending: Sequence diagram "open" step (trace-slowmo)`.
  Sequence diagram openness is not published. The lesson authors Live, slow motion and finished
  steps and remains quarantined. The runner and camera behavior are unchanged.
- Saved simulations: `owner decision pending: retry narration pause`. The specified
  `retry-storm` / `three-quick-retries` run narrates without pausing, so the required waiting and
  Continue steps cannot happen. The existing examples test explicitly pins nonpausing narration.
  Decide whether its first note should pause or choose a different saved run; the authored lesson
  stays quarantined until then.
