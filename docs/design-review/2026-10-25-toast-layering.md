## Toast layering: one stacking and portal order (PR #340)

The previous round kept an engaged toast still and bound its Undo to a history entry, but two P1s
remained. R-2b78e6e85e: an engaged toast could block export or modal-adjacent controls. R-192cc1420d:
the attempted fix hid every ordinary toast whenever any `aria-modal` element existed
(`body:has([aria-modal="true"])`), so a dialog's own feedback (Share link copied, Couldn't copy, the
clipboard refusal) was neither visible nor announced. Reverting the selector would bring the first
P1 back. The cause is that toasts had no layer of their own: they were body children at
z-index 240, above the palette (190) and inject frame (210) but below dialogs (250), and modal
state was detected with DOM queries and CSS.

### Decision

Toasts belong to one of three layers, and every surface fixed over the app takes its z-index
from one scale (`src/styles/tokens.css`, the `--layer-*` block):

| Layer, lowest first      | z     | Portal                                               | Holds                                                  |
| ------------------------ | ----- | ---------------------------------------------------- | ------------------------------------------------------ |
| Shortcuts sheet (modal)  | 150   | body                                                 |                                                        |
| Command palette (modal)  | 190   | body                                                 |                                                        |
| Canvas context menu      | 200   | body                                                 |                                                        |
| Tutorial coach, tip      | 205–6 | body                                                 | (pointer-events none; toasts stay above its dim)       |
| Inject frame (modal)     | 210   | body                                                 |                                                        |
| **Page notifications**   | 215   | the page-layer root (`div[data-toast-layer="page"]`) | the one ordinary toast, and one retained engaged toast |
| Menus (File, Export as…) | 220   | body                                                 | export menu items are above every page toast           |
| Dialogs (modal)          | 250   | body                                                 | **dialog feedback**, in the dialog's own feedback slot |
| Drop overlay             | 280   | body                                                 |                                                        |
| **Task** (export Cancel) | 300   | body                                                 | a task holding page input: progress and Cancel         |
| Colour picker (modal)    | 1000  | body                                                 |                                                        |

**Page notifications** sit below the dropdown menus (where every export item lives) and dialogs.
They stay above the tutorial coach's dim, so its toasts remain readable. The canvas context menu
(200) stays below them, as on master: it has no export or modal controls. The lower modals
(shortcuts, palette, inject) cannot be ordered above the coach without moving it, so they are
handled by stepping back rather than by z-index. Under any open modal, page notifications _step
back_: they keep their rectangle, are hidden and inert, and neither expire nor move. The page-layer root is a
body child, so every modal's existing background sweep (which marks body children inert as it opens
and restores them as it closes) covers it. That restoration happens in the same synchronous step in
which the modal returns focus — sometimes to a toast's action, as the palette does. A React-driven
`inert` would lag that step by a commit, and the focus would be lost. The CSS rule is
`[data-toast-layer][inert] > .ix-toast`, not a document-wide `:has()`.

**Dialog feedback** is declared at the call site (`inDialog: true` on Share link, Embed code,
Paste, Link with password, Sequence diagram and Import report outcomes) and belongs to the topmost
open modal that has a feedback slot. It renders inside that dialog's panel: inside `aria-modal`, so
its `status`/`alert` live region is announced, and inside the dialog's Tab cycle. It is placed once,
before it paints, and again only on a window resize while nothing engages it
(`feedbackPlacement`):

1. below the panel if the window has room (the usual case);
2. else (a short window) inside the panel, between body and footer, with the panel's height pinned.
   The body gives up the room and scrolls, so the header and footer do not move.

Dialogs are centred, so "above the panel" never has more room than below; that branch was dropped.

It never overlaps the panel's controls and never moves under the pointer. Each dialog has its own
slot with the page's rules: latest wins, an engaged toast holds its place while the next waits, and
expiry pauses while it is engaged. It is dismissed with the dialog: closing the modal layer drops
its slot, and `onDismiss` runs once. Background notifications raised while a dialog is open (an
agent's change, a peer) stay page notifications. They wait behind the dialog with their Undo
intact, rather than putting a page action inside a modal.

**Tasks** stay on top: a task holds all page input (`src/lib/inputHold.ts`), so only its Cancel can
be reached. A retained page toast behind a task is hidden and inert, keeping its rectangle, as
before.

### Ownership

`src/lib/modalLayers.ts` is the one modal stack. Every modal surface registers in the same effect
that makes the page inert, and leaves in that effect's cleanup: the `Dialog` shell (with its
feedback slot), the colour picker and the shortcuts shell through `useDialogInteraction`, plus the
palette, the inject frame and the shortcuts sheet. The toast store subscribes to it. Stepping back,
ownership and dismissal are derived from that stack, not from DOM queries, CSS `:has()` or effect
flags. The placement interval no longer queries `[aria-modal]`.

Keyboard focus inside a modal layer stays with the modal, as the focus policy already requires
(M3: a dialog returns focus to its own opener; D5: Tab wraps inside the dialog). Feedback buttons
are in the panel, so the dialog's own Tab cycle includes them. Dismiss returns focus, before the
toast unmounts, to where it came from, or else to the dialog panel. Escape and Tab therefore keep
working: on the body they would reach no handler. This is the toast analogue of L5 ("before the
notice unmounts"). The Toaster is app-wide and is mounted outside the canvas and in the viewers,
so it does not dispatch to a canvas controller. Escape closes the dialog in one press, because the
dialog is the modal owner. Feedback is not a surface and does not take an Escape press of its own.

### Alternatives rejected

- **Raise toasts above dialogs (master's 300).** Feedback is visible, but page notifications
  (with Undo) would cover dialog footers and reach into a modal's Tab order. This is R-2b78e6e85e.
- **Hide every toast while a modal is open (the attempted fix).** This is R-192cc1420d.
- **Implicit ownership ("a toast raised while a dialog is open is the dialog's").** An agent's Undo
  would land inside a modal and close with it, so its Undo would be lost.
- **Insert feedback into the dialog's layout.** It moves the dialog's own buttons (the
  panel re-centres), which is the missed-click defect in a new place. It is used only in the
  pinned-height fallback, where nothing moves.
- **New timers** (delay before an action is interactive, re-measure loops). They fight hover, and
  rule (a) already makes the engaged rectangle final. No timer was added. The page's existing
  250 ms bar-following interval is unchanged, and pauses while stepped back.

### Undo binding

Unchanged where a mounted canvas has bound its history. Where none is bound (a harness, a viewer),
an `undoes` action keeps master's unbound rule instead of becoming permanently inert. It goes when
anything else undoes or redoes. This fixed `src/live/threadFixes.test.ts`, which failed on the
branch.

### Motion

Reduced motion: the toast's entrance fade is removed (unchanged). Feedback in a dialog uses the
same fade-only entrance with no positional animation. Nothing is positioned by a transition.

### UX review

No controls, settings or chrome were added; the shortcuts and Share flows read as before. Feedback
shows next to the dialog that caused it, so the dialog no longer hides its own confirmation. A
background notification waits behind the dialog and comes back unchanged. Export menu items are
never covered by a toast. Under the tutorial coach's dim, toasts stay readable.

### Code map

- Layer scale: `src/styles/tokens.css:108-122`; consumers in `interop.css` (menu, notification,
  task, dialog, drop), `palette.css`, `canvas/dialog.css`, `canvas/context-menu.css`, `live.css`,
  `tutorials.css`, `colorPicker.css`.
- Modal stack: `src/lib/modalLayers.ts:20` (`openModalLayer`); registered in
  `src/components/useDialogInteraction.ts:73`, `src/palette/PaletteDialog.tsx:166`,
  `src/live/InjectFrame.tsx:51`, `src/components/ShortcutsDialog.tsx:182`.
- Feedback slot: `src/interop/ui/Dialog.tsx:72`.
- Store: `src/interop/ui/toast.ts:114` (layer close drops its slot), `:147` (`inDialog` routing),
  `:255` (`endPress`), `:272` (`engagedFor`).
- Toaster: page-layer root `src/interop/ui/Toaster.tsx:32`, dialog feedback `:70`, one-shot
  placement `:155`, Dismiss focus hand-back `:262`; `feedbackPlacement` in `toastStack.ts:43`.
- CSS: step-back `src/styles/interop.css:217`, task layer `:223`, dialog feedback `:232-248`.
