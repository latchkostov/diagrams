## Edit together: presence, who is here and what they point at (E5)

Collaboration plan slice E5, behind the collaboration switch (development and e2e builds).

- **Selections.** What another person selects shows as a 2 px outline in their colour, 4 px clear of the item, with
  their name on the first one. It never changes your selection.
- **Cursors.** Their pointer over the canvas shows in their colour with their name, sent at most 15 times a second
  (the last position wins). A cursor still for 5 s hides, and so does one whose person is away (their tab hidden).
- **Never your view or your keyboard.** Overlays sit in the canvas's own layer, take no pointer events and are hidden
  from assistive tech; each presence change reaches the camera as `remote.changed{presence}`, which decides nothing
  (row C1). An e2e checks the camera journal, the viewport and the focused element through a peer's selection and
  cursor.
- **Leaving.** A goodbye is sealed ahead of time and sent as the page goes, so a reload or a closed tab leaves at once
  instead of lingering 30 s as a second entry (E2's ghost). Otherwise entries expire after 30 s of silence. The room
  chip's live region says "Heron joined." and "Heron left." quietly, with no toast and no focus move.
- **Bounds.** A presence frame carries at most 32 selected ids (a longer selection is cut short to fit its 4 KiB
  frame); a cursor's coordinates and every key are checked. Presence frames have their own per-sender bound (200 per
  10 s, past it dropped and counted), so frequent cursors never ride free of rate limits (§1.3 #9).
- **E4 review fixes.** The chip's participants subscribe to presence itself (names and statuses update without the
  count changing). The no-answer wait belongs to the connection attempt in the session (Retry starts a fresh one).
  The room's state and joins/leaves are announced in a live region now that the chip is a button. The failure alert
  sits below the top bar however it wraps, and only over the room's canvas (not on Stencils). A joiner retrying from
  the chip keeps the keyboard on its wait. Save a file copy falls back to the room's document, then the kept copy.
  Share's description says the room stays open while anyone is in it, and leaving doesn't close it. The menu-target
  test counts id reads and asserts linear work.

## Verification

- Vitest: selection and cursor carried and timed; the 15 Hz cursor cap with the last position winning; a presence
  flood dropped past its bound and counted; parsing bounds; the pre-sealed goodbye; the no-answer wait per attempt;
  linear menu-target work.
- Playwright (`collab-room.spec.ts`, real WebRTC between contexts): a peer's outline and cursor with their name; no
  camera move, the same viewport and the same focused element; the cursor hiding after 5 s (paused clock); a reload
  leaving no second entry (fails with the goodbye removed); leaving clears the outline and is announced; Retry
  clearing "No one else is in this room" and starting a fresh wait; a joiner retrying from the chip keeps the
  keyboard on its wait; the alert below the bar on a phone and gone on Stencils.
- An away tab (hidden) says so to the others (unit), and others hide its pointer.
- Neighbouring specs (collab Lab, Share, annotations, drawing basics, viewport, inspector, round 4, platform): 125
  passed. Linux container under load (`--repeat 3`, 4 workers), room spec, collab Lab, viewport and annotations:
  201 of 201.
- Output parity: `node/i18n/catalogs.json` changed on purpose (two new English-only messages, "{alias} joined." and
  "{alias} left.", and Share's corrected description); no other golden changed.

## Review fixes (PR #183)

- **Never in what leaves the screen.** Others' outlines, pointers and names are left out of image exports (PNG and
  SVG share one filter), hidden while recording, while presenting and in print. Interactive HTML is built from the
  diagram, not the screen. An e2e exports SVG with a peer selecting and pointing: no alias, no presence markup.
- **No-answer after a failure that recovers by itself.** The session settles its connection state in one order
  (connectivity and failure first, then the no-answer deadline, then one notification), so a joiner whose
  matchmaking comes back with nobody there gets a fresh 30 s wait (it waited forever before).
- **The cached goodbye follows the counter.** It is sealed again after half a replay window of document frames, so
  a busy session's goodbye is never refused as stale (a test sends three windows' worth between heartbeats).
- Name tags are readable on every peer colour (white on the colour darkened, 4.5:1 or better); several people on
  one item get a ring each, one outside the other, and their names side by side; the cursor's screen position is
  converted at the cursor's own pace and never snapped to the grid; the selection key is computed once; the
  presence-flood test runs on two ends and a small bound.
