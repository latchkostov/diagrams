## Live view's Esc, keys and menus as table rows

Live view's Space, Enter and Esc now follow one written table, `src/canvas/interaction/liveKeys.ts`, and its focus
returns are rows of the focus policy (`focusPolicy.ts`). Each row comes from the code before this change and the specs
that pin it: live (Esc out of live, the panel's levels, the inject dialog, the expectations summary, presenting),
trace (selection, then the trace), capacity (the Inputs panel's Esc, the entry point's rate field), slowmo, present
and showcase-examples.

| Row | Key or event                       | Condition (first that holds)                           | Level or focus                          |
| --- | ---------------------------------- | ------------------------------------------------------ | --------------------------------------- |
| X1  | Esc                                | Slow motion on, nothing selected                       | Slow motion's own Esc                   |
| X2  | Esc                                | A recording runs                                       | The recorder's Esc                      |
| X3  | Esc                                | In a text field or inline editor                       | Its own                                 |
| X4  | Esc                                | A menu, dialog or Live panel is open                   | Its own                                 |
| X5  | Esc                                | A selection, focus on the canvas                       | The canvas clears it                    |
| X6  | Esc                                | A selection, focus off the canvas or in the trace card | Live view clears it                     |
| X7  | Esc                                | A message trace                                        | It ends (presentation doesn't hear)     |
| X8  | Esc                                | Presenting                                             | Presentation's own Esc                  |
| X9  | Esc                                | A highlighted path                                     | Cleared                                 |
| X10 | Esc                                | Otherwise                                              | Live view ends                          |
| X11 | Esc                                | Always on                                              | Nothing                                 |
| S1  | Space                              | Slow motion on                                         | Slow motion's own                       |
| S2  | Space                              | A text field, inline editor or control                 | Its own                                 |
| S3  | Space                              | Held                                                   | Swallowed                               |
| S4  | Space                              | A note waits                                           | Continue                                |
| S5  | Space                              | Otherwise                                              | Play or pause                           |
| N1  | Enter                              | A text field, inline editor or control                 | Its own                                 |
| N2  | Enter                              | A note waits                                           | Continue                                |
| N3  | Enter                              | Otherwise                                              | Nothing                                 |
| M5  | A bar popover closes with Esc      | It has an invoker (the expectations summary)           | The invoker, at once                    |
| M6  | A bar popover closes any other way |                                                        | Stays                                   |
| D2  | A Live panel's Esc                 |                                                        | Its opener, else the bar's "⋯"          |
| D3  | The inject dialog closes           |                                                        | Its opener, else the node it injects at |
| L1  | Any live key, at any level         |                                                        | Stays                                   |
| L2  | A presented note pauses            |                                                        | Its Continue (else the canvas)          |
| L3  | A trouble callout with focus goes  |                                                        | The canvas, if focus was lost           |
| L4  | A new entry point                  |                                                        | Its rate field, once the panel lists it |

No controls, text or layout changed. Chrome budget unchanged. Keyboard paths unchanged.

## Ambiguities resolved (flagged for the owner)

- **The "⋯" menu's Esc gives no focus back.** The expectations list gives focus back to its button on Esc; the "⋯"
  menu never has. Opened by a click, focus stays on "⋯" either way; tabbed into, its item goes with the menu and focus
  falls to the page. No spec pins either, and the brief says behaviour stays, so "⋯" reports no invoker (M5 keeps).
  Giving it one is a one-line change: see `docs/backlog/2026-10-18-live-more-menu-focus.md`.
- **Live's popovers aren't canvas surfaces.** The menus machine holds one canvas surface at a time and a pan or the
  wheel closes it. The bar's popovers have always stayed open over a pan and alongside a canvas menu until a press
  outside closes them. They report opening and closing to the focus policy, but stay out of the machine and out of
  `data-interaction-state` (so `waitForInteractionIdle` doesn't wait on an open "⋯").
- **Slow motion's Esc and Space usually never reach the table.** Slow motion's listener is added before live view's
  and stops the key, so X1 and S1 journal only when a key reaches live view while slow motion is on (it is arming,
  or slow motion declined it). The rows record the order the code always had.
- **The rate field's two seconds.** The entry point's rate field polled frames for up to two seconds. It is now the
  controller's one pending move and waits, parked, for the Inputs panel's next commits, with no time limit; it gives
  up if the panel closes first, and a later move replaces it, as everywhere else.
- **No scrolling on focus returns.** The panel's opener, the expectations summary and the inject dialog's node now
  take focus without scrolling, as every canvas focus does (the camera reveals the canvas). They are always in view
  when they take it. The Inputs panel's fields still scroll into their panel.
- **Presentation keeps its own Esc.** X8 says live view leaves the key to App; nothing about presenting moved.
