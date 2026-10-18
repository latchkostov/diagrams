## Edit together E2: interim room controls (development and e2e builds)

Reviewed at 1366 × 800 (light) and 390 × 844 (dark) in the e2e build: the start dialog, the link after Start room,
the chip in the save-status slot, the join dialog and the joiner's wait.

**Kept**

- One decision per dialog, with the plan's §2.2 and §2.3 wording. The disclosures are a plain list before the name
  field; the services line names every host contacted. Join's default focus is Don't join; after Start room the
  default is Copy, and Enter never starts or joins anything.
- No new top-bar control: the chip replaces the save status (or the shared chip) only while a room is open.
- A joiner's own diagram is never replaced: "Connecting to the room…" stands in the canvas's place, with Leave
  room, until the room's diagram arrives as a new entry in Your diagrams.
- Nothing moves the camera or focus on a peer's change; a room's canvas mounts once when it opens (a local action).

**Fixed in review (PR #174)**

- A joiner's waiting view takes focus when the dialog and canvas go together (focus no longer falls to the page).
- "Could not connect" in the chip reaches 4.5:1 or better in the light theme (darker than `--danger` alone).
- A room left running for another diagram no longer looks like the displayed diagram's: the chip reads
  "In a room: <title>" with Show and Leave room, and no Copy link.

**Recovery dialogs (PR #174, simplified)**

- A copy that can't be saved, and a device wipe that failed, each end in one modal that can't be dismissed (no
  close button, Escape or backdrop): its choices are the only way out, so the page never goes back to a state it
  can't keep. Focus starts on Try again.

**Interim, for E4**

- The chip's Copy link and Leave room are inline buttons. On a phone the chip takes its own row and its text
  truncates ("Room open · waiting for ot…"). E4's chip ("●● 3 here ▾") with the participant popover fixes both and
  routes the popover through the interaction controller (E3).
- The private explanation is one line without "Make it not private…"; E4 moves it into the Share chooser.
- Failure states use the existing "Could not connect" banner wording only; E4 adds §2.6's distinct states.
- New `collab.*` messages are English only until E4 settles them (backlog: collab E2 follow-ups).
