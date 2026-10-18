## Collaboration E2 follow-ups (room lifecycle in the app)

- **A reload leaves a ghost in presence for up to 30 s.** The reloading tab's goodbye is sealed asynchronously and
  the page is gone before it's sent, so peers keep its old sender in `session.peers()` until the presence TTL. The
  E2 chip counts connections (accurate after a reload) and only exposes presence as `data-present`. E5's participant
  list needs either a goodbye sealed ahead of time (counter reserved, sent synchronously on `pagehide`) or presence
  tied to the transport peer that carried it (keeping §2.6's "Reconnecting…" for a dropped peer).
- **A room for another diagram still takes the save-status slot.** E2's chip names the background room and offers
  Show, but the displayed diagram's save status (or shared chip) is hidden meanwhile. E4's chip and popover should
  show both.
- **Focus handoffs go through the interaction controller in E3.** E2 focuses the joiner's waiting view only when
  focus fell to the page; when the room's diagram arrives the canvas takes no focus request yet.
- **Translations for the new `collab.*` keys.** E2 adds the consent, chip and notice wording in English only;
  missing messages show in English. Translate once E4 settles the final wording.
- **Rejoining after Leave makes a second entry.** A joiner who leaves and later opens the same link gets a new entry
  in Your diagrams (the copy from before stays). By design nothing maps a room to an entry after Leave; E4 can offer
  "Rejoin into this copy" from the copy's own menu if people ask.
- **A creator whose checkpoint is gone waits for a peer after a reload.** With the encrypted checkpoint unavailable
  (site data cleared, IndexedDB blocked), a reload can't reseed the room from the plain copy (that would revert
  others). It shows "Connecting to the room…" with Leave; leaving keeps the copy. E4 should say why in that state.
