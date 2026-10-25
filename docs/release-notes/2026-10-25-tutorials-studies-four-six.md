## Design studies: notifications, RAG and cells

Added three milestone studies to the existing development/E2E tutorial catalog:

- **Notification fan-out:** respect three provider quotas, add a queue and dead-letter path per channel, then
  keep email and push delivering through an SMS outage and resume SMS delivery after recovery.
- **A RAG latency budget:** measure the waiting caller's p95, model repeated questions with an 80/20 cache split,
  and reserve search headroom for a seeded reindex slowdown.
- **Bookings in cells:** separate services into boundaries, demonstrate that a failing deploy stays in one cell,
  then add another regional entry and keep booking when the original entry goes down.

Each study starts from an invented partial diagram and ends at its existing public reference example. Targets
appear only after Show me. Skip, Continue and the real UI solution paths use the existing completion contract;
the runner and editor behavior are unchanged. No extra app controls or test IDs were added.

These are simulation models: cache Share is an assumed hit rate, reindexing is a slowdown, and the small cells
omit storage and replication. Finish questions point learners to those limits and the fuller reference designs.

The only intended parity change is `tests/parity/goldens/node/i18n/catalogs.json`: 79 new English tutorial keys
increase each language's message count by 79 and its tutorials-area digest. English fallback counts rise by
74 in the 37 non-English languages (five strings already have translations through their shared English
wording); the pseudo-locale translates all new messages and keeps zero fallbacks. Existing translated
messages and other areas retain their output. Simulation and rendering goldens are unchanged.
