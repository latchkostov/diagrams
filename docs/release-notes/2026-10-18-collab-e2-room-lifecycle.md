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
  without asking again and never reseeds. Edits the checkpoint hadn't saved when the page went are kept beside the
  record as one CRDT update (everything past the last saved checkpoint's state vector, deletions included) and
  merged back in: a merge only adds those edits, so newer state saved meanwhile by a peer or another tab is never
  reverted. The plain copy in Your diagrams is never replayed into the room, and what a reopened room recovered is
  written back to it (a copy counts as current only once a save of it succeeds). A room link in the address waits for
  its answer before this tab's earlier room resumes.
- **Leave room** disconnects only you; your copy stays in Your diagrams. A page kept in the back/forward cache
  leaves for the time being and rejoins with the same document when shown again.
- **Private** diagrams never start or join a room, checked before anything is contacted. Privacy is also watched
  outside the canvas: marking the room's diagram Private (here or in another tab) leaves the room even while
  another diagram is showing. When a room leaves because its content became Private (the switch, or a paste from a
  Private diagram), the entry in Your diagrams is marked Private before the canvas is handed back, so the kept copy
  never becomes shareable. If this device can't record that (storage full or blocked), the room still disconnects
  and cleans up; the canvas stays as it is, Private in memory only, nothing of it is saved, and the notice says to
  save a file copy. The watcher reads only the entry's privacy flags, never the whole diagram.
- **Clear everything on this device** now stops an open room first, then empties the room recovery database in one
  IndexedDB transaction that records the new storage generation, and waits for it. A tab that hasn't heard about
  the wipe can no longer write an old room back: every recovery write checks that record first. This resolves the
  C1b device-wipe prerequisite (backlog entry removed; threat model updated). The recovery database moves to
  version 4 (a `lifecycle` store); older Lab databases upgrade in place.
- The interim controls (consent dialogs, a status chip in the save-status slot with Copy link and Leave room, the
  joiner's "Connecting to the room…") carry the plan's wording; E4 adds the Share row, Ctrl+K, the participant
  popover and the failure states. While a room goes on for another diagram, the chip names it and offers Show
  instead of its link. Participants are capped at 8. The e2e build contacts no public service; its
  tests emulate a tracker inside Playwright.

## Verification and network evidence

- Vitest, `src/collab/room/lifecycle.test.ts` on the in-memory network (24 cases): the creator seeds once; a link
  never seeds; a second "creator" with an old copy can't revert a peer's edit; consent before any transport;
  Private refused before any transport; a Private paste keeps the copy Private; Private set in another tab leaves
  the room; reload rejoin; unsaved edits merged back after a reload; newer checkpoint state preserved when pending
  edits outlive their write; A's pending title and B's saved description both survive on both peers; an older copy
  never replayed; an invitation waits before resume; the copy written only when the room changed; Leave (also
  during a reload's rejoin); Leave after checkpoint recovery, and after another tab advanced it, keeps the recovered
  copy; a pending deletion survives a reload alongside a peer edit (and a second reload, with matching sync proofs);
  a failed Private write still disconnects and cleans up; the room's own link; back/forward cache; wipe. The privacy, merge and invitation cases
  fail with their fix removed.
- Playwright, `tests/e2e/collab-room.spec.ts`: two browser contexts with real WebRTC over host candidates and a
  tracker emulated in the runner: start, consent with zero sockets and zero peer connections before Join, edits
  both ways, reload, hard drop; Leave and Don't join; a damaged link; Clear everything with a second tab that
  missed the wipe, whose encryption started before the wipe and was released after it, then the old link restores
  nothing. The wipe case fails with the
  generation check removed.
- Real public network (local only, not CI): 24 of 24 joins through `tracker.openwebtorrent.com` and
  `tracker.webtorrent.dev` with Cloudflare STUN, two separate Chromium processes on this machine (host candidates,
  so signalling, not NAT traversal). Join to diagram on screen 0.84–3.57 s (median 1.63 s); edits arrived in 1–5 ms
  both ways; every reload rejoined without asking again in 0.87–1.82 s with the latest edits.
- Output parity: one golden changed on purpose, `node/i18n/catalogs.json`: every language lists 44 more messages
  (2,202 → 2,246), the new English-only `collab.*` keys count as fallbacks, and the `collab` area hash changes.
  No other golden changed.
