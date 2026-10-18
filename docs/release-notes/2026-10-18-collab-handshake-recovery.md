## Collaboration handshake recovery

- Tracker loss now disposes each unfinished incoming handshake, including remote-description setup and ICE
  gathering. Cleanup checks the peer's identity, so obsolete work cannot remove a replacement peer. Established
  data channels survive tracker outages. Fresh offers can connect automatically without Retry.
- Automatic recovery hands keyboard focus from the disappearing Retry or Save a file copy button to the room
  status through the interaction controller. Focus elsewhere stays where it is.
- Disconnect and Connect retain the same room's edited CRDT document. Opening a different room does not reuse it,
  and reconnecting never hydrates the demo over existing edits.
- Room creation is reserved during initialization and committed only after activation. A rejected initial diagram
  restores eligibility for a corrected retry; concurrent opens cannot both hydrate the room.
- Session tests now deliver connectivity notifications directly, checking failure deadlines, cancellation before
  expiry and automatic banner clearing after expiry without pressing Retry.

These are fixes to the existing Lab spike. No controls, endpoints, simulation features or production permissions
were added. Output parity must remain unchanged; no golden updates are intended.

## Regression evidence

The handshake regressions hold remote-description setup or ICE gathering across tracker loss and prove both peers
connect automatically afterward. Temporarily restoring the previous transport makes both regressions fail.
Removing reservation rollback, concurrent reservation or the connectivity subscription also fails its dedicated
regression. Browser coverage checks focus from both banner controls and outside it, plus edited-document retention,
continued editing and isolation when creating another room.

The first Linux load repetition exposed the existing recovery-abort browser test racing the automatic retry: the
supposedly undurable edit could be saved before reload. The test now pauses its installed clock before the aborted
write and resumes only after reload. Both staged-write cases retain their last-durable-state assertions.

Disabling focus transfer and document retention makes their three browser regressions fail, while the outside-focus
case still passes. Restoring the fixes passes all 30 collaboration browser cases. Before syncing upstream, all
10,669 unit tests pass, with four skipped; the production build and entry size pass (107.1 kB gzip against the
123.5 kB budget).

The automatic-recovery cases also require completed disconnection and no page errors. Their socket fake accepts
sends after opening; retaining its old unconditional send failure makes all three cleanup checks fail. The corrected
fake passes the complete 30-case collaboration run.

After the upstream showcase sync, stale persistent Vitest transforms produced eight example/gallery failures.
The same suites passed all 37 checks with that cache disabled, and the stale caches were cleared. Assertions and
goldens were unchanged; [cache invalidation follow-up](../backlog/2026-10-18-vitest-glob-cache.md) records the evidence.

Before syncing upstream, output parity passes: **2,196 goldens, 0 changed, 0 added, 0 missing, 0 stale**, with all 77
Linux browser cases passing. This fix changes no golden relative to master. The five-repeat Linux load run passed
all new review regressions, but recorded
six whole-test deadline failures in four other cases (669 passes); the separate
[load-deadline follow-up](../backlog/2026-10-18-collab-load-deadlines.md) records their scope and baseline protocol.

## Real-network evidence

The final verified build connected and delivered the room document in **20/20 trials (100%)**, each using two
separate Chromium processes and the two approved public trackers, without Retry. Joins took **0.869–1.648 s**,
with a **0.884 s** median. Both processes ran on this machine; all selected candidate pairs were
`host/udp -> host`. This supports signalling reliability, not cross-network NAT traversal.

The local guarded production-mode E2E bundle was served without CSP, as in the previous spike evidence; production
CSP support remains outside this fix. Every browser and the probe server stopped. An earlier probe built during
deliberate mutation checks was discarded; these results are from the restored fixes only.
