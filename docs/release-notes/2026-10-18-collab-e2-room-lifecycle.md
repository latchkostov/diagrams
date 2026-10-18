## Edit together: a room's life in the app (development and e2e builds)

Collaboration plan slice E2. Rooms now run in the real app, behind the same switch as the Lab (`DEV` or
`VITE_E2E`); production builds still contain none of it (`bundleSplit.build.test.ts` unchanged).

- **Starting** asks first (the start dialog: who sees your IP address, the services contacted, your name in the
  room). Only a room made on this device seeds the room with the diagram, once. An example, a shared diagram or a
  blank draft becomes one of your diagrams first; the room keeps that entry up to date as anyone edits.
- **Joining** a `#room=` link, on load or pasted into an open tab, removes the link from the address at once and
  asks first (Don't join is the default). Nothing is contacted before Join: no tracker socket, no peer connection.
  The diagram that was open is never touched: the room becomes a new entry in Your diagrams once a peer sends it.
  A damaged, newer, mixed or in-query link says why and opens nothing.
- **A reload keeps this tab in the room** (owner decision Q4): the room's value lives in this tab's
  `sessionStorage` only, until Leave, the tab closing or Clear everything. It reopens from the encrypted checkpoint
  without asking again and never reseeds. An edit made just before the reload that the checkpoint hadn't saved yet
  is replayed from the copy in Your diagrams as an ordinary edit; an older copy is never replayed over newer room
  state.
- **Leave room** disconnects only you; your copy stays in Your diagrams. A page kept in the back/forward cache
  leaves for the time being and rejoins with the same document when shown again.
- **Private** diagrams never start or join a room, checked before anything is contacted.
- **Clear everything on this device** now stops an open room first, then empties the room recovery database in one
  IndexedDB transaction that records the new storage generation, and waits for it. A tab that hasn't heard about
  the wipe can no longer write an old room back: every recovery write checks that record first. This resolves the
  C1b device-wipe prerequisite (backlog entry removed; threat model updated). The recovery database moves to
  version 4 (a `lifecycle` store); older Lab databases upgrade in place.
- The interim controls (consent dialogs, a status chip in the save-status slot with Copy link and Leave room, the
  joiner's "Connecting to the room…") carry the plan's wording; E4 adds the Share row, Ctrl+K, the participant
  popover and the failure states. Participants are capped at 8. The e2e build contacts no public service; its
  tests emulate a tracker inside Playwright.

## Verification and network evidence

- Vitest, `src/collab/room/lifecycle.test.ts` on the in-memory network (13 cases): the creator seeds once; a link
  never seeds; a second "creator" with an old copy can't revert a peer's edit; consent before any transport;
  Private refused before any transport; reload rejoin; replay of an unsaved edit, and no replay of an older copy;
  Leave; the room's own link; back/forward cache; wipe. The Private and replay cases fail with their fix removed.
- Playwright, `tests/e2e/collab-room.spec.ts`: two browser contexts with real WebRTC over host candidates and a
  tracker emulated in the runner: start, consent with zero sockets and zero peer connections before Join, edits
  both ways, reload, hard drop; Leave and Don't join; a damaged link; Clear everything with a second tab that
  missed the wipe and a held checkpoint write, then the old link restores nothing. The wipe case fails with the
  generation check removed.
- Real public network (local only, not CI): 24 of 24 joins through `tracker.openwebtorrent.com` and
  `tracker.webtorrent.dev` with Cloudflare STUN, two separate Chromium processes on this machine (host candidates,
  so signalling, not NAT traversal). Join to diagram on screen 0.84–3.57 s (median 1.63 s); edits arrived in 1–5 ms
  both ways; every reload rejoined without asking again in 0.87–1.82 s with the latest edits.
- Output parity: one golden changed on purpose, `node/i18n/catalogs.json`: every language lists 41 more messages
  (2,202 → 2,243), the new English-only `collab.*` keys count as fallbacks, and the `collab` area hash changes.
  No other golden changed.
