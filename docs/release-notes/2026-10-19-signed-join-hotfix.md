## Edit together: joining a signed room always gets the diagram (hotfix)

Since signed rooms (P4), a joiner on a real network could connect (the host saw them join) yet never get the diagram.
In a signed room every frame is checked against its sender's presence binding. When the host's presence reached the
joiner late or not at all, the joiner held the host's sync replies until it could check them. Anti-entropy kept asking
for the whole diagram, so the held replies piled up past their bound, or waited past 30 seconds. The joiner then
quarantined the honest host for the rest of the session, and everything the host sent was ignored. The same could
happen the other way round: a host could quarantine a joiner whose presence was late.

- **Never held against an honest sender.** What a session holds only because it can't check it yet (the sender's
  binding late or lost, or a sync reply from someone not yet known as an editor) is dropped past its bounds, never
  quarantined. It's asked for again as soon as it can count: a sync request when the binding arrives, or when a grant
  makes the sender an editor. Only updates from a sender the session can check, that never came to count (a viewer's
  edit), still get their sender quarantined.
- **Bindings first.** A signed session answers every sync request with its presence first, on the same ordered
  channel. A session without the document sends its presence with every request, so the next anti-entropy round brings
  both bindings ahead of the diagram, whatever the network lost or reordered.
- **A browser that can't sign** (no Ed25519 in WebCrypto) joining a signed room is told plainly: "This browser can't
  join this room…", instead of failing to connect.
- **Diagnostics.** The joiner's wait says why: "Connected. Checking who's here…" or "Connected. Waiting for the
  diagram…". The wait and the room chip carry `data-waiting` (`peers`, `verifying`, `document` or `none`) and
  `data-rejected` (what this page refused, by reason). In e2e builds, `window.__room` exposes the room's lifecycle.

Tests: `src/collab/joinResilience.test.ts` covers, between sessions on the in-memory network:

- the host's presence lost once, or for a long while;
- a large document that travels in fragments while the host's presence is late;
- frames reordered, lost and duplicated;
- the joiner's presence lost at the host;
- an honest host held too long, which is never quarantined;
- the waiting reasons.

Every case that failed on master passes now. `room/lifecycle.test.ts` covers the browser that can't sign.
`tests/e2e/join-resilience.spec.ts` runs two browsers over real WebRTC, with the host's data channel losing its presence
frames for 35 seconds: on master the joiner never gets the diagram, and with this fix it does. i18n: three new strings
(`collab.waitVerifying`, `collab.waitDocument`, `collab.unsupportedBrowser`), so the catalogs golden is re-recorded.
