## Live's Esc, keys and menus through the interaction controller

The interaction controller (`src/canvas/interaction`) is the single writer of keyboard focus and menus in
`src/canvas`, but Live keeps its own: `src/live/usePanelEscape.ts` (Esc closes Live's panels), the control bar's
and the trace card's own `.focus()` calls, the note callout and the inject dialog. They were left alone because a
pure-refactor split of `src/live/LiveSession.tsx` into `src/live/session/*` runs in parallel and owns `src/live/`.

## Follow-up

Once both branches have landed: dispatch Live's panel Esc and its focus returns as interaction events (a
`dialog.closed` kind for Live's panels, an Esc row like E1), make the Live panels a surface the menus machine knows
about if their Esc should give focus back to an invoker, and extend the ESLint focus ban to `src/live/**` with an
allowlist for focus that stays inside one component. Add a policy row and a journal assertion in `live.spec.ts`
for each.
