## Ordinary flow-label text floor — R-bee0214c79

Apply the screen text floor to ordinary Message and Request captions with collision-aware sizing
and placement. A prototype that counter-scaled their existing containers enlarged max-content
caption boxes beyond the router's measured bounds. The full Linux sweep found 15 failures in
the existing layout audit: labels covered cards or each other in fitted and auto-laid-out
public diagrams. The attempt and its font-style goldens were withdrawn.

This is more than a one-line wrapper or selector change. Keep the 10.5 px screen floor, preserve
the existing overlap assertions, and make larger captions slide along their routes or hide when
there is no clear space. Cover both readable text and collision avoidance; preserve export
capture behavior. The seven P1 fixes do not depend on this follow-up.

## Verification

Clean origin/master `e9272eb520cb802c0a4cf97c34e3f5b2be9203a6` passed the unchanged
`layout.spec.ts` twice in Linux: 250 passed, zero failed or flaky. After withdrawing the
prototype, the same layout spec plus the five P1 browser regressions passed twice: 260 passed,
zero failed or flaky. All 3,178 parity goldens match without recording new output. The complete
2,724-case Linux sweep was run once; its 15 overlap failures prompted this withdrawal. It was
not repeated after the targeted recovery checks, following the fix-round verification budget.
