## Canvas CSS routing ownership and one-time cascade proof

Request-routing styles now live in `src/styles/canvas/routing.css`, imported immediately after
`inspector.css`. The 219-line section retains its declarations and cascade position. This is an
internal refactor with no user-visible change.

After the move, the final run of `node scripts/check-canvas-css.mjs` reported:
`Canvas CSS: 563 rules unchanged; all reordered rules independent.` The one-time checker, frozen
fingerprint baseline and baseline-dependent tests were then removed. A small structural test only
requires an import-only canvas index with distinct, existing files; ordinary rule edits need no
baseline update. This supersedes the retained-checker description in the earlier extraction note.

The 24-case production stylesheet-swap check passed with exactly zero differing decoded pixels
across six surfaces, two viewport sizes and both themes. No parity goldens changed, were added,
removed or re-recorded. The final file map and validation are in the
[design review](../design-review/2026-10-17-canvas-css-routing.md).
