## Scheduled bundle trim UX review

No controls, vocabulary or diagram output change. Optional surfaces retain their existing entry
points. The required designer-agent review inspected the trim and its eager recovery shells.

The review preserved keyboard Retry and early search typing, loading-menu viewport placement,
Live menu Escape ownership, overflow fold state and the Inputs panel's original focus-return
target. Recovery stays outside downloaded chunks. Capacity analysis participates in image-export
readiness; editing-only surfaces are skipped. Tooltip affordances keep their existing
focus/selection rules, and room presence stays excluded from visual exports.

The trim deliberately keeps the minimap, engine, particle renderer, playback controls, next-node handle and copy confirmation synchronous. The handle deferral was rejected after Linux connection regressions; the copy confirmation must remain visible while its existing lifetime runs.
The new production-build regression and generated held-chunk cases cover every registered surface;
focused browser regressions cover searchable-menu recovery, cancellation, Live Escape ownership,
fold retention and capacity-panel focus return. Menu matching and the early Enter/Escape path remain eager, and keys on other controls remain theirs. Full output parity is checked without updating goldens.

The designer-agent recheck found no remaining blocking issues after these corrections. Test-driver
names and paths are removed only at build time; runtime surface ids and export policies stay intact.

The final cold-load recheck covers committing the buffered query before search focus, replaying
held Home/arrow/Enter navigation in order, and consolidating node identity with its deferred panel
so a second download cannot steal later focus. The designer agent found no blocking source concerns.
