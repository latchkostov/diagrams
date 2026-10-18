## Focus and menus as one table

Keyboard focus in the canvas now follows one written table, `src/canvas/interaction/focusPolicy.ts`, instead of
rules spread across effects, refs and frame callbacks. Each row comes from the code before this change and from the
specs that pin it: undo-selection, flow-building, round7/round13 polish, structure-bulk (keyboard navigation), the
i18n context menus, a11y, text-fields, editor, relationships, checks-ui, collab-c1a, palette-command and firstrun.

| Row | Event                                                                                  | Condition                             | Focus goes                                                                                                                      |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| M1  | A menu closes with Esc                                                                 | It had an invoker                     | Back to the invoker after the commit (the canvas if it has gone)                                                                |
| M2  | A menu closes by pick, outside press, scroll, blur, resize, drag, command, replacement | It had an invoker                     | Back to the invoker after the commit, only if focus was lost                                                                    |
| M3  | A menu closes                                                                          | No invoker, or the shortcuts dialog   | Stays (a dialog gives focus back to its own opener)                                                                             |
| M4  | A menu opens                                                                           |                                       | Stays (the menu takes focus inside itself)                                                                                      |
| K1  | Tab, Shift+Tab, Ctrl+Alt+arrows                                                        | To a node                             | That node, next frame; the Tab stop moves at once                                                                               |
| K2  | Ctrl+Alt+] / [                                                                         | To a connection                       | That connection, next frame                                                                                                     |
| H1  | Undo / Redo                                                                            | Focus was on the canvas               | The first selected node in Tab's order once drawn, else the first selected connection, else the canvas                          |
| H2  | Undo / Redo                                                                            | Focus was elsewhere (the toolbar)     | Stays; the Tab stop moves to the selection                                                                                      |
| P1  | The palette adds a node                                                                |                                       | The node, once drawn                                                                                                            |
| P2  | The palette goes to a node                                                             |                                       | The node, now                                                                                                                   |
| S1  | Selection by click, box, placement or a command                                        |                                       | Stays                                                                                                                           |
| N1  | Enter or Esc in a name field                                                           |                                       | The named item on the canvas                                                                                                    |
| I1  | F2, Enter, double-click, Rename, a new node's name                                     | A new request                         | The field, once mounted for its item, all of it selected (or the caret at the end); again a frame later unless input came first |
| I2  | The same request again                                                                 | Already taken                         | Stays                                                                                                                           |
| I3  | The Inspector opens or folds, by its control or with the selection                     |                                       | Stays                                                                                                                           |
| D1  | The Checks card closes                                                                 |                                       | Its opener (else the canvas)                                                                                                    |
| E1  | Esc on the canvas                                                                      | From a node or a connection           | Back on it two frames later, if focus was lost                                                                                  |
| C1  | The gallery hands over the canvas                                                      |                                       | The canvas, next frame                                                                                                          |
| C2  | Presenting starts                                                                      |                                       | The canvas, if focus was lost                                                                                                   |
| C3  | Start blank                                                                            |                                       | The stencil search, next frame                                                                                                  |
| C4  | Dependencies hidden                                                                    | Focus was on one                      | The canvas                                                                                                                      |
| R1  | A peer's change                                                                        | What had focus in the canvas has gone | The canvas, next frame, and it says why                                                                                         |

Nothing a person sees changed apart from the two fixed bugs (a context-menu hover during a language change, and
edge cycling before its focus frame) and the two edge cases flagged below. No controls, text or layout changed.
Chrome budget unchanged. Keyboard paths unchanged.

## Ambiguities resolved (flagged for the owner)

- **"Undo from the keyboard" means "Undo with focus on the canvas".** The brief says Undo from the keyboard moves
  focus and Undo from the toolbar keeps it there. The code decides by where focus is, not by the input device: Ctrl+Z
  pressed while a toolbar button or the Inspector has focus also keeps focus. That is what the passing spec pins
  (`undo-selection.spec.ts`, "undo from the keyboard moves focus…"), so H1 and H2 keep it.
- **Esc whose invoker has gone.** Before, a menu restored its invoker only if focus had been lost, and Esc in a
  menu always loses it, so the two read the same in practice. M1 now gives focus back on Esc unconditionally. When
  the invoker has left the document (a peer deleted it), focus goes to the canvas instead of staying on the page
  body. Every other close (M2) still yields to whatever the action or the press focused.
- **One pending move.** A field request waiting for a folded Inspector (opening from Live's panel, say) used to wait
  in the Inspector's effect indefinitely. Now it is the one pending move, and a later focus move, such as a Tab,
  replaces it. No spec covers waiting, then moving, then opening, and the replacement matches "a newer move wins"
  everywhere else.
- **The platform.** macOS Control-click opens a context menu, and the platform reaches the policy as an explicit
  input on menu events. No row reads it differently today, and no spec drives a Control-click, so the cross-product
  only asserts that the decision is the same on both platforms.
- **The command palette** is the app's dialog, outside the canvas. Its own open, close and focus return stay with it.
  Its canvas commands (go to a node, add one) are policy rows P1 and P2.
- **Menus inside the Inspector** (the stencil and relationship dropdowns) are the Inspector's own controls, not
  canvas menus. They keep ContextMenu's built-in focus return, which `editor.spec` and `relationships.spec` pin.
