## Live session modules and engine-cost sampling (2026-10-18)

Split the live session into frame-loop, trace/slow-motion, playback/recording, capacity-input,
live-fix, context-menu and keyboard hooks, plus the edit-mode capacity component. The shared
reduced-motion subscription now lives in `src/lib/useReducedMotion.ts`. The split preserves
hook order, effect kinds and dependency arrays, DOM, camera events, accessibility and UI copy.
The session directory inherits the translation lint; six existing literals retain narrow
exceptions so this move does not change translations.

The separate #149 P2 fix samples engine cost only when an advance moves simulated time.
Paused, held, waiting, finished and zero-step frames retain the previous estimate rather than
diluting it and making the next slow frame attempt too much catch-up. Regression tests use
synthetic CPU readings and compare the next step with a same-run baseline; removing the fix
fails all five idle-frame cases.

No parity golden changes are intended or recorded. Playback output and startup chunk boundaries
remain unchanged.
