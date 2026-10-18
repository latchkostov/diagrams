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

- **UX review fixes for E2's dev-only UI (review 2026-10-18, finding 9).** One message at a time: the copy that
  couldn't be saved no longer brings a storage toast with it (a room's final save reports through its dialog), and a
  failed Clear everything says only what its dialog says (no "You left the room" about the copy it's erasing). The
  failed wipe's dialog is titled "Couldn't clear everything", with the error and "Everything else was cleared." in
  place of the list. While connecting, the room chip is status only (the wait has Leave room; there's no room to link
  yet); while a chip shows, the brand stays on one line and the chip and picker truncate instead (1280 px). Join's
  consent now says the same two lines as Start's (the services never see the diagram or the link; end-to-end
  encryption and your copy).

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
- Linux container under load (`--repeat 5`, 6 workers): the room spec, the collab Lab and the neighbours above passed
  539 of 540. The one failure was E2's wipe test running out of its 30 s budget while still working: it and the
  two-browser test are now marked slow (no assertion changed), and the room spec then passed 50 of 50 (`--repeat 5`).
- Output parity: `node/i18n/catalogs.json` changed on purpose: two messages added (`clear.failedTitle`,
  `clear.restCleared`) and two removed (`collab.joinIpTrackers`, `collab.joinCopy`, now Start's lines); the `clear` and
  `collab` area hashes change. No other golden changed.
