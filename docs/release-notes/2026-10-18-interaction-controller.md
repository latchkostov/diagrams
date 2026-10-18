## One controller for the canvas's menus, focus and selection causes

Internal architecture, modelled on the camera controller. `src/canvas/interaction/` owns what opens over the canvas,
where keyboard focus goes in it, and why the selection changed.

- **Menus.** Context menus (node, edge, boundary, note, selection, pane), quick-add, quick-add beside its outline and
  the keyboard shortcuts dialog open one at a time through one pure machine (`menus.ts`). Each opens with what had
  focus and closes with a reason: pick, escape, outside, scroll, replaced, blur, resize, gesture, command or unmount.
  This replaces the scattered `setMenu(null)` calls, the `shortcutsOpen` state and the `menuOpen` ref mirrored in a
  passive effect. The machine tells the camera `menu.opened` and `menu.closed` directly, so `usePaneCamera` no longer
  diffs the menu's kind.
- **Focus.** The controller is the only code in `src/canvas` that calls `.focus()` or moves the canvas's Tab stop.
  A pure `focusPolicy(state, event)` turns every event into exactly one command: keep, a focus move, or a Tab-stop
  move. The rules are a table in `focusPolicy.ts`, and every current rule is a row. A move runs at the time it names:
  now, after the commit, on the next frame, two frames later, once its target is ready, or once it is measured. It
  is held as data, so a newer move replaces it, it never lands on an element that has left the document, and it
  waits on commits and rendered frames rather than timers.
- **What was replaced.** Twelve direct `.focus()` calls and the deferrals around them: canvas requests from the
  gallery, presenting, the Checks card's return, Start blank, keyboard navigation, edge cycling, Undo and Redo,
  hidden dependencies, the Inspector's name fields, the palette's go-to and add, and Esc on the canvas. Also removed:
  the `stepping` and `navFocus` refs, the `focusId` state (the Tab stop is now the policy's `roving`), the
  `remoteFocusFrame` effect, the Inspector's field-focus effect and its `done` ref, and the palette host's 30-frame
  focus retry.
- **Selection causes.** Each source declares its cause: a click (or React Flow's own selection), a right-click, the
  box, a placement, keyboard navigation, Undo or Redo, or the palette. Anything else is programmatic. Each commit
  that changes the selection becomes one `selection.changed{cause}` event, which both the focus policy and the camera
  hear. The camera only hears a new, non-empty selection. Placements declare themselves to the controller, which
  passes them on to the camera.
- **Readiness for tests.** `data-interaction-state` on `canvas-wrap` reads `idle`, `menu-open` (a menu or the
  shortcuts dialog is open) or `focus-pending` (a move is waiting for its commit, frame or target). A field request
  waiting for a folded Inspector doesn't hold it. `waitForInteractionIdle` waits on it. E2E builds keep a journal of
  every decision and each move's result in `window.__interactionJournal`; `noTestHooks()` fails any other build that
  names it. The undo, menu Esc, double-Tab and name-field specs now assert the journal too.
- **Lint.** ESLint rejects `.focus()` and menu or Tab-stop setters in `src/canvas` outside the controller. The
  allowlist has two files where focus stays inside one component: the Inspector's segmented control and inert notes,
  and the sheet's resize handle.
- **Tests.** Table cases for every policy row and an invariant cross-product of 6,352 state × event cases: exactly one
  command per event, Esc always restores the invoker, a move to something that can disappear has a fallback, the
  platform never changes a decision, and Undo from the toolbar never moves focus. Fast-check sequences cover the
  policy and the menus machine. Deterministic-frame controller tests run fast-check interleavings of menus, keyboard
  navigation, Undo, field requests, removals, frames and commits.

### Behaviour changes

- **Fixed:** if a language finished loading during a context-menu row's hover delay, the row's submenu never opened
  while the pointer rested on it. The hover now starts again with the new language's rows.
- **Fixed:** two Ctrl+Alt+] presses before the frame that focused the first edge chose the first edge again
  ("Outgoing 1 of 2"). Navigation now goes on from the pending destination, an edge's as well as a node's.
- Esc in a menu whose invoker has gone (deleted by a peer) puts focus on the canvas instead of leaving it on the page.
- A node added from the command palette takes focus once React Flow has drawn it, however long that takes. Before,
  the palette gave up after 30 frames.

### Output parity

No golden changed.
