## Auto-layout and Tidy route-reset parity

The approved golden exception records the existing design rule: Auto-layout and Tidy reset
shaped routes incident to moved nodes and show a notice with Undo.

Only `tests/parity/goldens/browser/layout/corpus-hand-shaped-lines.json` is re-recorded in
this follow-up. Its 16 changed fields are the same eight fields for each command (`autoLayout`
and `tidy`): four edge paths (`api-db`, `jog`, `detour`, `shape-end`), three label styles
(`api-db`, `jog`, `detour`) and the viewport. The paths lose their hand-shaped detours; labels
follow the automatic routes and the fitted viewport follows their smaller bounds. Node boxes,
node and label text, and all other fields remain unchanged.

The separate i18n golden change is described in the feature's
[release note](2026-10-24-edge-node-moves.md). No other golden update is approved here.

Full parity passes: 3,147 goldens, zero changed, added, missing or stale; 1,855 Node tests
and 108 Linux browser tests pass. Every other golden matches without re-recording.
