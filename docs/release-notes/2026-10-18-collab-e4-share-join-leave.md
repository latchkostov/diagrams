## Edit together: Share's row, Ctrl+K, the room chip and failure states (E4)

Collaboration plan slice E4, behind the collaboration switch (development and e2e builds; production has no rooms yet).
This is the first path from a normal button: **File ▸ Share… ▸ Edit together…**.

- **Share…** gets an **Edit together…** row after **Link with password…**, behind its own rule ("Anyone with the link
  can edit while you're there"). It is never the default focus; the arrow keys reach it. A **Private** diagram has no
  room row, and Share's line reads **Links, rooms and public embeds are off for a private diagram.**
- **Ctrl+K** finds **Edit together…** as "collaborate", "room" and "edit together". On a Private diagram it opens the
  start dialog's explanation, never a disabled row.
- **The room chip** (the top bar's save-status slot) is one button: "●● 3 here ▾", "Room open · waiting for others",
  "Reconnecting…" (30 s after a peer drops), then "Everyone else left · your copy is safe". Its menu lists who is here
  (you, by your name in the room; each peer by theirs, marked unverified, with their status) and has **Copy room
  link** and **Leave room** (no "End for everyone"; Leave needs no confirmation). While a joiner connects it is status
  only. If copying is refused, the link opens selected in a dialog.
- **Failure states (§2.6).** Matchmaking unreachable: "Could not connect to this room." (and, for a handshake that
  failed, "Your network or theirs blocks direct connections."), with Retry and **Save a file copy**, announced and
  never moving focus; Retry keeps the keyboard on the chip. A joiner nobody answers for 30 s is told "No one else is
  in this room right now. They may have left, or their network may be blocking it.", with Retry.
- Join's consent says the same two lines as Start's. UX principles gain the room's vocabulary, row order and consent.
- **E3 review fixes:** context menus track boundaries (single and in a selection) as targets, so a peer deleting one
  closes its menu; menu targets are checked against one index of the document per update (linear, not quadratic);
  a menu closed by a peer's deletion says why in the canvas's live region; the chip no longer clips its actions (they
  are in its menu).
- **A Private mark that isn't recorded** (no entry to mark) now counts as a failure, as storage refusing it does:
  nothing is written as an ordinary copy.

## Verification

- `collab-room.spec.ts` (real WebRTC between contexts, emulated tracker): Share's row order, default focus and
  keyboard path, start through it, the chip's menu (you by name, Copy room link, Leave), refused copy with the
  selectable link and focus back to the chip; Ctrl+K by "collaborate"; a Private diagram without the row, with the
  line and Ctrl+K's explanation; matchmaking unreachable (alert, file copy contents, Retry focus); a peer leaving
  (Reconnecting… then Everyone else left, on a paused clock); a joiner nobody answers; joining focuses the connecting
  status (Tab reaches Leave room) with delivery held, then the canvas; toolbar focus kept when the canvas arrives;
  remote removal of a boundary and of a selected boundary closes the menu, says why and returns focus; a Private
  paste whose Private mark fails reaches neither the peer nor the stored copy and its file copy is Private; the chip
  and its menu on a phone. axe (WCAG 2.1 AA) on Share, the start dialog, the chip's menu and the alert.
- Share's existing specs (`share-chooser`, `sharing-privacy`) now expect the room row and the rooms wording in the e2e
  build, where rooms are on.
- Output parity: `node/i18n/catalogs.json` changed on purpose (15 new English-only messages: the chip's states and
  menu, the failure wording, Share's row and its Private line, Ctrl+K's entry; "Copy room link" replaces "Copy link").
  No other golden changed.
