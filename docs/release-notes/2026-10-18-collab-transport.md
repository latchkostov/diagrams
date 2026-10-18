## Collaboration Lab transport and room state

- Each tracker now owns its periodic and quick re-announce schedule. A late reply from either tracker cannot
  delay a newcomer until the next two-minute announce.
- Closed tracker sockets reconnect with capped exponential backoff and jitter. Rapid open/acknowledge/close
  cycles still back off; Retry and leaving cancel obsolete work. Existing peer channels survive tracker outages.
- Empty rooms and the last remaining participant stay in a normal waiting state. The existing failure banner
  is reserved for unreachable matchmaking or a handshake that failed after an authenticated peer was found.
  Diagnostics distinguish waiting, connected, unreachable trackers, stalled handshakes, ICE failure and peer departure.
- Only the first open of a room minted here can hydrate its initial diagram. Opening an invitation or reopening
  the original room object merges the room's CRDT state, even if the Lab's creator checkbox is selected.
  Previously, a second hydration wrote competing Yjs map entries under a new client ID and could silently win
  over another participant's title, node edits and deletions.
- Defaults contain only `wss://tracker.openwebtorrent.com` and `wss://tracker.webtorrent.dev`.

All changes remain Lab-only. No new controls, production endpoints, CSP permissions, backend, relay or TURN service
were added. Public-network evidence stays local and is not part of CI; all regression tests use offline fakes.

## Verification and network evidence

Each fix has a deterministic regression test, confirmed to fail with its original behavior temporarily restored.
Coverage includes both late-tracker response orders, independent intervals, an hour of reconnect failures,
flapping sockets, timer cancellation, established-channel survival, subsequent peer discovery, failure classes,
and a returning second creator after another participant renamed/moved/deleted content.

Planner baseline with both approved trackers: **14/22 joins (63.6%)**, successful joins **0.77–1.75 s**.
Local after-fix runs: **48/48 joins (100%)** in two batches. The first batch joined in **0.862–4.353 s**
(median **1.581 s**); the final-implementation batch joined in **0.856–1.964 s** (median **1.572 s**).
Each trial used two separate
Chromium processes and a room invitation through the real public trackers. Both peers were on this machine;
all selected candidate pairs were `host/udp -> host`, so this verifies signalling, not cross-network NAT traversal.
The guarded production-mode E2E bundle was served locally without CSP, matching the planner's CSP-free dev probe;
production CSP support remains outside E1. Every browser and the local server was stopped.

All **10,660 unit tests passed**, with four skipped; the quick gate's two collaboration browser suites passed
**26/26**, with zero failed or flaky. Production build, entry size (107.2 kB gzip / 123.5 kB budget), lint,
typecheck, format, i18n and skill freshness checks passed. Lint retains three existing Fast Refresh warnings.
Output parity is unchanged: **2,196 goldens, 0 changed, 0 added, 0 missing, 0 stale**, with all 77 Linux browser
parity cases passing. No golden files were updated.
