## UX review

The bezel, rail and dock must be fully translated at first paint, independently of optional surfaces. Their labels stay in core and have a source-level ownership check.

Gallery and command discovery keep a translated loading or error frame with one Retry action. Close and Escape still dismiss command discovery. Retry is reachable by keyboard; failed loading releases pending type-ahead ownership, and the loaded palette receives focus after the loading frame finishes cleanup. Existing diagram edits stay intact while optional inspector strings wait.

No persistent controls were added. Retry appears only after a failed download. Tutorial titles have their own small catalog so browsing commands does not download every lesson.

## Readiness review

A language switch never leaves a surface on a stale loading message. Stencil search menus show one translated
Loading or Retry row where results go, keep focus and typed text in the search, and honour Enter once results
arrive. The palette's loading dialog keeps its Close button keyboard-operable. Findings in the inspector show
an inline Retry instead of a second toast. No controls were added.
