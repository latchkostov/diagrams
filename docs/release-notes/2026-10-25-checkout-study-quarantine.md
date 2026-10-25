## Checkout study quarantine

The Checkout design study is temporarily unavailable after reaching its review round cap with an
unresolved saved-run caller override bug in Partner quota's Skip recovery. Its tests and saved
progress are retained. Restoration criteria and all three review findings are recorded in
`docs/backlog/2026-10-24-tutorials-quarantine.md`.

The milestone format and Dispatch study remain available. Syncing with master regenerated only
`node/i18n/catalogs.json` to combine master's restored-lesson messages with the study messages.
Compared with this branch before sync, catalog message counts increase by 20, fallback counts
increase by 20 except in the pseudolocale `en-XA`, and tutorial-area hashes change. Other catalog
areas and parity goldens remain unchanged; the quarantine flag itself changes no golden output.
