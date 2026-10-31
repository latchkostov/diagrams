## Remaining PR 399 round 1 P2s

- R-145e7ad350: add scoped-reset coverage with completed and unfinished progress in another chapter, preserving exact saved steps and dates after chapter and lesson reset. This is separate coverage for the reset implementation, beyond the five P1 fixes.
- R-cd20f8f345: replace parallel track and seal arrays with a shared chapter manifest, resolving associations by track ID. This changes catalog structure and deserves its own focused review.
- R-6b44e80f97: add a browser regression that interacts with an uncovered canvas area while the finish sheet remains open and asserts both the context menu and sheet remain visible. The dismissal regression in this fix round covers the separate stale-listener failure.
