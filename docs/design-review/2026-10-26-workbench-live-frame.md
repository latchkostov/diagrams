## Live frame review

The footer has one primary play action, a visible speed selector and the current simulation. The canvas no longer lies under playback or narration. The dock ends on the footer boundary; narration has one direct route to its subject's details. The status strip uses no obstacle translation and has no shadow. RTL uses inline layout properties.

At 1440px the transport spans exactly the 1440px window and ends at 900px; the caption sits above it. The first production inspection exposed overflow for a long simulation name at 1024px, corrected by folding secondary readouts and expectation dots into their existing summary. Phone playback moves below the tool rail pending step 11's full phone layout.

## Validation

The status regression fails with the previous floating-placement implementation and passes with the strip. The browser suite caught the old focus port's immediate-parent assumption; the port now resolves the enclosing canvas-view. A direct unit regression covers both library search and inspector-toggle focus across the new column. The unchanged Live spec passes all 35 cases after restoring the standalone Lab toggle and updating explicit theme-menu setup.

The first gate ran 37 passing and 8 failing browser cases; the second ran 77 passing and one failure (the renderer still searched for the old canvas Live dot). The renderer now finds the bezel dot within its own app. A lint inference error from passing trouble through a memo was corrected by giving the caption its subject directly. No lint rule, assertion or timeout was relaxed.

Entry gzip9 is 110,096 B, 10 B below the part-1 measurement of 110,106 B; the 123,500 B budget is unchanged. Final targeted gate and static results are recorded with the delivery report.

## Final checks

Final quick subset: 12 unit and 28 browser cases passed with zero failures or flakes. The earlier complete Live selection passed all 35 cases. Production build and i18n validation passed. The Linux five-repeat neighbour run could not obtain six worker slots and exited 75; CI remains responsible for that load check. Parity completed with catalog and rendered-golden differences; no goldens were changed, per the step-12 sequencing rule.
