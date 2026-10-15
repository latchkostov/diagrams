# PR #122 review resolution

The ten P2 findings in `.reviews/20261015-162847/REPORT.md` are valid and reduce to three app bugs and
two coverage gaps. No finding was rejected as a false positive.

| Report finding (in report order)                | Resolution                                                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Expose the selected relationship             | Dropdown describes its trigger with the rendered selected label, or Mixed. Custom triggers retain the same description.                   |
| 2. Prevent a second click from reopening        | ContextMenu excludes its optional trigger ref from outside pointer dismissal; Dropdown owns the toggle.                                   |
| 3. Connect aria-controls                        | Dropdown passes its menu ID through ContextMenu to the root role=menu element.                                                            |
| 4. Coordinate trigger clicks                    | Duplicate of 2; covered by the same fix and repeated-click browser regression.                                                            |
| 5. Forward the controlled menu ID               | Duplicate of 3; covered by the same fix and expanded-menu browser assertion.                                                              |
| 6. Allow clicking the trigger to close          | Duplicate of 2.                                                                                                                           |
| 7. Expanded accessibility and keyboard coverage | Production browser tests cover arrows, Enter, Escape, checked state, focus return, controls/ID linkage and axe on the expanded menu.      |
| 8. Assert the relationship glyph                | Unit coverage checks the selected SVG path; browser coverage checks all eight option paths and the trigger after flow/dependency changes. |
| 9. Exclude the trigger from outside dismissal   | Duplicate of 2.                                                                                                                           |
| 10. Connect aria-controls                       | Duplicate of 3.                                                                                                                           |

The CI failure is an app focus regression, not an obsolete test assumption. InertNote's generic
`button[aria-expanded]` lookup started matching the new dropdown. Restricting it to the section's
heading button preserves disclosure focus and the original Label fallback. The existing failing
sim-truth assertion stays, with Tab/Shift+Tab coverage for the replacement trigger.

Rejected approaches: relaxing that focus assertion would hide the regression; adding a second popup
implementation would duplicate ContextMenu's keyboard and dismissal logic. Both components retain
Heiner's structure and naming. The UX gate also removed redundant async/sync from option labels,
retaining those terms in hints. No new simulation, planning or stencil feature needs a showcase.

This checkout has no separate context-menu spec: its context-menu keyboard, submenu, dismissal and
focus cases live in `editor.spec.ts`, with accessibility coverage in `a11y.spec.ts`.

The stale skill viewer is refreshed and the plugin version is exactly one patch above master.
No output change is intended and no parity golden is re-recorded.
