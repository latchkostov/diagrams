## Review scope

Seven P1 findings in the final PR #358 review round, plus the optional Prompt API test setup P2.

## UX decisions

Automatic selection inspection is temporary: an existing AI composer survives and returns when
selection clears. Explicit dock closure keeps its existing semantics. Escape dismisses the
topmost owner first, preserving the flyout that opened a dialog and its focus-return target.

Phone sheets reserve the actual covered bottom edge at peek, half and full height; changing a
snap informs the existing camera policy without adding a new camera action. Pinning the library
keeps the full canvas width on phones. Docked Checks supplies a persistent programmatic focus
destination when there are no surviving finding controls.

The timeline's physical coordinates stay left to right in RTL locales; transport chrome remains
RTL. No controls or chrome were added.

The optional ordinary flow-label text-floor attempt was withdrawn after the full Linux sweep
found caption overlaps. Enlarging captions requires collision-aware sizing and placement; this
exceeds the round's one-line P2 scope and is recorded in the backlog.

## Regression evidence

Targeted unit and production-browser regressions cover draft survival, modal Escape and focus
return, sheet geometry and snap notifications, edge-style refresh, last-finding focus recovery,
Arabic pointer seeking and phone pinning. Each fix is checked by
temporarily restoring its previous implementation and observing the regression test fail.
