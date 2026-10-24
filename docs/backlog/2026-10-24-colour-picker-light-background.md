## Light background tint flake

Owner: latchkostov. The test at `tests/e2e/colour-picker.spec.ts:130`, “background tint is undoable
and survives presentation in light”, failed on scripts-only PR #268 on 2026-10-23. This is one
reported observation; no isolated reproduction is claimed. The exact title is recorded in
`tests/flakes.json`. Investigate presentation/Undo readiness without weakening the assertions.
