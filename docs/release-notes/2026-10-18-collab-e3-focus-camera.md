## Edit together: a peer's changes never move your view or take your focus (E3)

Collaboration plan slice E3. Every focus or camera effect of a room now goes through the canvas's camera and
interaction controllers as an event with its cause (development and e2e builds; production has no rooms yet).

- **Camera.** A peer's change is `remote.changed` (kind `doc`, and `presence` for E5). Policy row C1: it decides
  nothing, from any state: no move, no owner claimed, and pending work (a fit you started) stays pending. A property
  test runs random event sequences with and without peers' changes interleaved and requires identical commands.
- **A context menu whose target a peer deleted** closes with the new reason `remote` (row M7, extending R1): its
  commands would act on nothing. The canvas takes the keyboard back after the commit, only if focus went with the
  menu. Menus now carry the flow ids they act on.
- **The room's own handoffs** go through an interaction controller of their own (the room's controls live outside
  the canvas): a room dialog closing gives focus back to its opener, else the canvas (`dialog.closed` room, D6); the
  joiner's wait takes focus only if it was lost with the canvas (W1); the room's canvas replacing the wait takes it
  only if it went with the wait (W2); Retry hands the keyboard to the room's status (W3), and any other change of
  state is only announced (W4). The shared dialog shell takes an optional `restoreFocus` for this; other dialogs are
  unchanged.

## Verification

- Vitest: the new focus rows (M7, D6, W1–W4) in the invariant cross-product; C1 from every owner, cause and menu;
  the interleaving property for `remote.changed`. Interaction and camera suites: 1,607 passed.
- Playwright (`collab-room.spec.ts`, real WebRTC between two contexts, emulated tracker): a peer deleting the
  right-clicked node closes the menu with `menu.closed:remote`, the canvas has focus, and the guest's camera journal
  has no move and the viewport is unchanged through a peer's rename and deletion; joining hands focus to the wait,
  then to the room's canvas (journal: `dialog.closed:room`, `room.waiting`, `room.ready`); Cancel on the start
  dialog gives focus back to its opener; Retry leaves the room's status focused. The menu and canvas cases fail with
  their dispatch removed. Neighbouring specs (collab Lab, share chooser, annotations, drawing basics, round 4,
  viewport, platform, inspector): 120 passed.
