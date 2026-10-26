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

| Layer, lowest first      | z     | Portal                                               | Holds                                                    |
| ------------------------ | ----- | ---------------------------------------------------- | -------------------------------------------------------- |
| Shortcuts sheet (modal)  | 150   | body                                                 |                                                          |
| Command palette (modal)  | 190   | body                                                 |                                                          |
| Canvas context menu      | 200   | body                                                 |                                                          |
| Tutorial coach, tip      | 205–6 | body                                                 | (pointer-events none; toasts stay above its dim)         |
| Inject frame (modal)     | 210   | body                                                 |                                                          |
| **Page notifications**   | 215   | the page-layer root (`div[data-toast-layer="page"]`) | the one ordinary toast, and one retained engaged toast   |
| Menus (File, Export as…) | 220   | body                                                 | export menu items are above every page toast             |
| Dialogs (modal)          | 250   | body                                                 | **toasts raised while it is open**, in its feedback slot |
| Drop overlay             | 280   | body                                                 |                                                          |
| **Task** (export Cancel) | 300   | body                                                 | a task holding page input: progress and Cancel           |
| Colour picker (modal)    | 1000  | body                                                 |                                                          |

**Page notifications** sit below the dropdown menus (where every export item lives) and dialogs.
They stay above the tutorial coach's dim, so its toasts remain readable. The canvas context menu
(200) stays below them, as on master: it has no export or modal controls. The lower modals
(shortcuts, palette, inject) cannot be ordered above the coach without moving it, so they are
handled by stepping back rather than by z-index. Under any open modal, page notifications _step
back_. A notification that is engaged, or that the modal was opened from (its recorded opener),
stays mounted: hidden and inert, its rectangle kept, neither expiring nor moving, so the modal can
hand the keyboard back to it. Any other notification waits in the store, with its Undo binding and
expiry paused, and is shown and announced afresh when the modal closes. Unmounting rather than
hiding keeps exactly one toast in front while a dialog shows its own. The page-layer root is a
body child, so every modal's existing background sweep (which marks body children inert as it opens
and restores them as it closes) covers it. That restoration happens in the same synchronous step in
which the modal returns focus — sometimes to a toast's action, as the palette does. A React-driven
`inert` would lag that step by a commit, and the focus would be lost. The CSS rule is
`[data-toast-layer][inert] > .ix-toast`, not a document-wide `:has()`.

**While a dialog is open**, every ordinary toast raised meanwhile belongs to the topmost modal that
has a feedback slot. This covers the dialog's own outcome (Share link copied, Couldn't copy, a
refused paste, "Duplicated · Open") and anything else that happens meanwhile: a lazy part's Retry,
an agent's change with Undo, slow motion failing to download. No call site has to declare it, and
nothing is hidden behind the dialog. If it is still live when the dialog closes, it returns to the
page layer, where latest wins as ever. An Undo or a Retry is therefore never lost with the dialog,
and an action that must wait for the dialog (slow motion's Retry) still can. It renders inside the
dialog's panel: inside `aria-modal`, so its `status`/`alert` live region is announced, and inside
the dialog's Tab cycle. It is placed once, before it paints, and again only on a window resize
while nothing engages it (`feedbackPlacement`):

1. below the panel if the window has room (the usual case);
2. else (a short window) inside the panel, between body and footer, with the panel's height pinned.
   The body gives up the room and scrolls, so the header and footer do not move.

Dialogs are centred, so "above the panel" never has more room than below; that branch was dropped.
The inject frame is anchored at its top (at the node), so its slot is marked `inline`. Its feedback
is the frame's last row, the frame grows downward, and nothing in it moves. With
`display: contents`, the empty slot adds no grid gap.

It never overlaps the panel's controls and never moves under the pointer. Each dialog has its own
slot with the page's rules: latest wins, an engaged toast holds its place while the next waits, and
expiry pauses while it is engaged. A toast that outlives its dialog keeps its id, so its resources
stay held and `onDismiss` runs exactly once, whenever it is finally removed.

**Tasks** stay on top: a task holds all page input (`src/lib/inputHold.ts`), so only its Cancel can
be reached. A retained page toast behind a task is hidden and inert, keeping its rectangle, as
before.

### Ownership

`src/lib/modalLayers.ts` is the one modal stack. Every modal surface registers in the same effect
that makes the page inert, and leaves in that effect's cleanup: the `Dialog` shell (with its
feedback slot), the colour picker and the shortcuts shell through `useDialogInteraction`, plus the
palette, the inject frame (with an inline slot) and the shortcuts sheet. Each passes its opener: the
element its own code already sampled to hand focus back to. The toast store subscribes to it. Stepping back,
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
- **Declared ownership (`inDialog` at each dialog's call site), with every other toast stepping
  back.** This was tried first in this round. The full suite showed what it misses: background
  outcomes that must be usable while a dialog is open (slow motion's Retry behind Share), and each
  missed call site silently hid feedback. Raising toasts in the dialog's layer, and returning
  survivors to the page when it closes, has neither failure.
- **Insert feedback into the dialog's layout.** It moves the dialog's own buttons (the
  panel re-centres), which is the missed-click defect in a new place. It is used only in the
  pinned-height fallback, where nothing moves.
- **New timers** (delay before an action is interactive, re-measure loops). They fight hover, and
  rule (a) already makes the engaged rectangle final. No timer was added. The page's existing
  250 ms bar-following interval is unchanged, and pauses while stepped back.

### Undo binding

- **A history is bound.** The toast binds as before, with four corrections, all found by
  `round4-polish.spec.ts` ("a text that grows over an edge moves clear, with Undo"). The branch had
  made that Undo permanently unavailable.
  1. Capture records the pending edit early but keeps its step's tag. What settles right after (the
     text's measure) merges into the step the Undo names, as it would have without the early
     recording. Previously the measure became a second step.
  2. An entry keeps its opaque id when an edit merges into it (`historyController.commit`, via
     `merges` in `history.ts`). The step is the same, and so is what Ctrl+Z would reverse.
  3. "The document is ahead of its history" is _pending_, not stale: invalidation waits.
     Activation records the pending edit first. A merged edit keeps the Undo; a new step makes it
     stale.
  4. An Undo notification follows its _rendered_ edit. Capture's `flushSync(() => {})` renders only
     urgent updates, not ones a timer or animation frame scheduled. The text move (`settleText`) and
     a resized boundary's adoption (`boundaryResized`) now render their edit synchronously before
     notifying, as the drag settlement already did on this branch.
- **No history is bound** (a harness, a viewer). An `undoes` action keeps master's unbound rule
  instead of becoming permanently inert: it goes when anything else undoes or redoes. This fixed
  `src/live/threadFixes.test.ts`, which failed on the branch.

### Motion

Reduced motion: the toast's entrance fade is removed (unchanged). Feedback in a dialog uses the
same fade-only entrance with no positional animation. Nothing is positioned by a transition.

### UX review

No controls, settings or chrome were added; the shortcuts and Share flows read as before. Feedback
shows next to the dialog that caused it, so the dialog no longer hides its own confirmation. A
notification from before the dialog waits behind it and comes back unchanged; one raised during
the dialog shows beside it and stays on the page afterwards if it is still live. Export menu items are
never covered by a toast. Under the tutorial coach's dim, toasts stay readable.

### Code map

- Layer scale: `src/styles/tokens.css:108-122`; consumers in `interop.css` (menu, notification,
  task, dialog, drop), `palette.css`, `canvas/dialog.css`, `canvas/context-menu.css`, `live.css`,
  `tutorials.css`, `colorPicker.css`.
- Modal stack: `src/lib/modalLayers.ts:20` (`openModalLayer`); registered in
  `src/components/useDialogInteraction.ts:73`, `src/palette/PaletteDialog.tsx:166`,
  `src/live/InjectFrame.tsx:51`, `src/components/ShortcutsDialog.tsx:182`.
- Feedback slot: `src/interop/ui/Dialog.tsx:72`.
- Store: `src/interop/ui/toast.ts` (`publish`, layer routing in `show`, survivors returned to the page
  in the `modalLayers.subscribe` handler, pending-aware `invalidateUndo`, `endPress`, `engagedFor`);
  history side in `src/editor/useHistory.ts` (`entry`, `HISTORY_PENDING`, the capture keeping its tag),
  `src/editor/historyController.ts` (`commit` keeps a merged step's id) and `src/editor/history.ts` (`merges`).
- Toaster: page-layer root `src/interop/ui/Toaster.tsx:32`, dialog feedback `:70`, one-shot
  placement `:155`, Dismiss focus hand-back `:262`; `feedbackPlacement` in `toastStack.ts:43`.
- CSS: step-back `src/styles/interop.css:217`, task layer `:223`, dialog feedback `:232-248`.

### Startup chunks

`toast` was already a startup chunk. Its imports `machine` (the engagement machine, added earlier on
this branch) and `modalLayers` are shared with lazy surfaces, so the bundler emits each as its own
small preloaded startup chunk. `bundleSplit.build.heavy.test.ts` pins that list, and both were added
to it deliberately, with reasons. Startup JavaScript stays within budget (see Validation).
