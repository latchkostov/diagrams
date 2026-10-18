## Collaboration E2 follow-ups (room lifecycle in the app)

- **A reload leaves a ghost in presence for up to 30 s.** The reloading tab's goodbye is sealed asynchronously and
  the page is gone before it's sent, so peers keep its old sender in `session.peers()` until the presence TTL. The
  E2 chip counts connections (accurate after a reload) and only exposes presence as `data-present`. E5's participant
  list needs either a goodbye sealed ahead of time (counter reserved, sent synchronously on `pagehide`) or presence
  tied to the transport peer that carried it (keeping §2.6's "Reconnecting…" for a dropped peer).
- **A room for another diagram still takes the save-status slot.** E2's chip names the background room and offers
  Show, but the displayed diagram's save status (or shared chip) is hidden meanwhile. E4's chip and popover should
  show both.
- **Keep Undo through a Private exit (from PR #174).** A paste from a Private diagram ends the room and the canvas
  remounts from the kept copy, so that paste can't be undone there. Keeping the room's canvas mounted instead needs
  its local history handed to an ordinary canvas (a room canvas doesn't autosave, so leaving it mounted would lose
  later edits): an editor-level history handoff, not a room change. Deferred from E4 for that risk.
- **The room chip's menu is the top bar's menu (E4).** It opens and closes like File and View (focus back to the
  chip), not through the canvas's interaction controller, so the camera doesn't hold pending work while it is open.
  If a fit landing under the open menu turns out to matter, route top-bar menus through it together.
- **Not yet in E4:** "Left room · your copy" on the copy in Your diagrams (§2.5); an e2e for "Your network or theirs
  blocks direct connections" (the ICE failure needs a tracker that forwards an unusable answer under the room's
  signalling key); alias edit and presence come with E5.
- **Translations for the new `collab.*` keys.** E2 adds the consent, chip and notice wording in English only;
  missing messages show in English. Translate once E4 settles the final wording.
- **Rejoining after Leave makes a second entry.** A joiner who leaves and later opens the same link gets a new entry
  in Your diagrams (the copy from before stays). By design nothing maps a room to an entry after Leave; E4 can offer
  "Rejoin into this copy" from the copy's own menu if people ask.
- **A creator whose checkpoint is gone waits for a peer after a reload.** With the encrypted checkpoint unavailable
  (site data cleared, IndexedDB blocked), a reload can't reseed the room from the plain copy (that would revert
  others). It shows "Connecting to the room…" with Leave; leaving keeps the copy. E4 should say why in that state.
