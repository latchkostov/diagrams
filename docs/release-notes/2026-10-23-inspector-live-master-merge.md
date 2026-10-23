## Inspector Live details with message types and line editing

Merged master into #257, retaining the lazy Messages section and edge reader, Live edge-label hit handling,
connect-to-dot, and the Inspector's pinned Live readouts and deferred naming. Generated skill files start
from master and are refreshed with `pnpm regen`.

The connection inspector's loading/recovery shell and the node identity fields load separately, keeping
the canvas within its existing first-view budget. Held-download tests cover typing, Enter and Escape
at each naming boundary. Deferring the entire node panel was rejected because it moved shared code
into Live and exceeded that separate budget; simulation controls retain their existing boundary.

Exactly one golden is regenerated beyond master's recorded outputs: `node/i18n/catalogs.json` combines
master's message-type keys with this branch's 17 `workspaceLive` keys. Each locale has 2,898 messages;
English fallback counts rise by 17 where applicable and the `workspaceLive` area fingerprint is added.
No diagram, simulation, export or browser output is intentionally changed by this merge.
