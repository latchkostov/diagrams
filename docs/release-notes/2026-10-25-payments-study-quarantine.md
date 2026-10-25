## Payments study quarantine and Dispatch completion

The Payments design study is temporarily unavailable after reaching its review round cap with an
unresolved saved-run caller override bug. Its tests and saved progress are retained. Follow-ups and
restoration criteria are in `docs/backlog/2026-10-24-tutorials-quarantine.md`.

Dispatch stays available. Its partition milestone now requires Dispatcher to process at least ten
messages, so a disconnected input cannot complete the study merely by keeping backlog at zero.
The existing partition comparison and saved-run expectation remain required. No parity goldens changed.
