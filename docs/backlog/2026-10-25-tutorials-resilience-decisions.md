## Build 09 tutorial owner decisions

- `load-shedding`: owner decision pending: 5. Build 09, load-shedding (earlier owner decision 10).
  The quarantined draft has `run-spike` and `watch-backlog`. Its inline seeded run demonstrates an API waiting on
  a slow database. Choose the explicit shedding setting and spike interaction before adding the cap and
  rejected/bounded-backlog steps. No max-in-flight substitute was chosen.
- `dead-letters`: owner decision pending: 6. Build 09, dead-letters replay.
  The quarantined draft has `run-poison`, `watch-dead-letter` and `max-deliveries`. The app cannot re-send from a
  DLQ. Decide whether to narrate that operation before adding the final step; no fake replay was authored.

Both drafts are registered in the catalog and generated browser test inventory. Their authored steps run in the
completion sweep as release candidates, including Continue and selection perturbations; discovery remains
quarantined until the owner resolves the lesson's missing part.
