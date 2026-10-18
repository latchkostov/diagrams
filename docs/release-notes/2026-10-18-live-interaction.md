## Live view's keys, popovers and focus through the interaction controller

Internal architecture: live view's keyboard, its bar's popovers, its panels and every focus move it makes now go
through the canvas's interaction controller (`src/canvas/interaction`), as the canvas's own menus and focus do. A
person sees no change.

- **Space, Enter and Esc as a table.** `liveKeys.ts` is a pure function from what the call site knows (slow motion,
  a recording, a text field or control, an open menu, dialog or panel, the selection and where focus is, a trace,
  presenting, a highlighted path, always-on, a waiting note) to the level that takes the key. Esc backs out one level
  in the order it always had: its owners first, then the selection, the message trace, presentation's own Esc, the
  highlighted path, and live view itself. `useLiveKeyboard` asks the controller (`liveKey`), which journals each
  decision as a `live.key` event, and then runs the level it was given.
- **Popovers with reasons.** The bar's "⋯" menu and the expectations list report opening and closing to the
  controller, with a reason (pick, escape, outside, toggle, unmount). Esc in the expectations list gives focus back
  to its button at once (row M5); every other close leaves focus where it went (M6). They aren't canvas surfaces:
  they don't close a canvas menu, aren't closed by a pan or the wheel, and don't hold `data-interaction-state`.
- **Focus returns as events.** A Live panel's Esc (`dialog.closed:livePanel`, D2: its opener, else the bar's "⋯"),
  the inject dialog's close (`dialog.closed:inject` with its reason, D3: its opener, else the node), a presented
  note's Continue (L2), a trouble callout that had focus (L3: the canvas, if focus was lost) and a new entry point's
  rate field (L4) are focus-policy rows, run by the controller's DOM port.
- **Replaced.** Five direct `.focus()` calls (the panel's Esc return, the expectations list's Esc, the inject
  dialog's return, the presented note's Continue, the trouble callout's return) and the entry point's rate-field
  retry, which polled frames for up to two seconds. The field now waits, parked, for the Inputs panel to list it,
  without a time limit and without holding readiness, and gives up if the panel closes first.
- **Lint.** The focus ban now covers `src/live/**`. Live had no ESLint exceptions to remove; three files keep
  focus that stays inside one component (the inject dialog's first field and Tab trap, the trace card's hop list,
  the bottleneck callout keeping focus on itself) and are on the justified allowlist.
- **Tests.** Table cases for every `liveKeys` row and an invariant sweep over all 24,576 contexts (an owner of Esc
  means live view leaves it alone, presenting or always-on never exits, Esc never plays and Space never backs out,
  one level per press). Focus-policy rows M5, M6, D2, D3 and L1 to L4 with their table cases, and the cross-product
  extended with them. Controller tests for each. The live, trace and capacity specs assert the journal: the level
  each Esc took, the panel's and the popover's focus return, the inject dialog's reason, the rate field's move.

### Output parity

No golden changed.
