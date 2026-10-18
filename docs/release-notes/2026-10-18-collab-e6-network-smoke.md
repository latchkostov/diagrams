## Edit together: a Nightly smoke over the real network (E6)

Collaboration plan slice E6 (§4.2). Report-only: it never fails a run or blocks a merge, and never runs on pull
requests.

- **What it does.** Each night two browsers on one runner open the e2e build (`vite preview`, collaboration switch
  on). One starts a room through File ▸ Share… ▸ Edit together…, and the other opens the link and joins. They use
  the approved public trackers (`tracker.openwebtorrent.com`, `tracker.webtorrent.dev`) and Cloudflare STUN only,
  named through `__collabEndpoints` exactly as the app's own list has them. The smoke then checks that renames sync
  both ways, that the joiner's selection shows on the creator's canvas, and that Leave ends the joiner's room and
  the creator sees them gone.
- **What it records.** It records:
  - the time to connect;
  - each direction's sync time;
  - the selected ICE candidate pair (host, srflx or relay, and the protocol);
  - per tracker, the sockets opened and the frames received;
  - each side's room connectivity.
- **Why it failed.** A failure is classed as trackers unreachable (no tracker answered), ICE/NAT (trackers answered,
  but the peers never connected) or an app error (a page error, or a failure after the peers connected). That way a
  bad night on the public network reads differently from a bug. The trace is kept in the `nightly-collab-smoke`
  artifact.
- **Report and alert.** The night's table goes into the Nightly summary. A trend job reads the last scheduled
  nights' artifacts. After three failed nights in a row it opens, or comments on, the `nightly-failure` issue (the
  owner's decision); fewer show only in the summary.
- **How it stays out of PR CI.** Its Playwright project (`collab-smoke`, `tests/network/`) exists only with
  `COLLAB_SMOKE=1`, so PR CI's project list can't contain it.
- **Until E7.** The production CSP doesn't yet allow the trackers, so the smoke's pages bypass CSP. E7 adds them to
  `connect-src` and removes the bypass.
- **For diagnostics.** The room chip and the connecting status carry `data-connectivity`, which is never shown.
- **E5 review fixes.** Others' outlines index who selected what once per render instead of once per item. Each ring
  carries `data-testid="presence-ring"` and the person's name.

## Verification

- **Vitest** (`collabSmoke.test.ts`), covering the report script:
  - the summary in each failure class;
  - escaping a `|` in a message;
  - the streak and the alert at three nights;
  - earlier nights read newest first, with a night that has no result counted as failed.
- **The smoke, run locally over the real network:** passed. It connected in 3.4 s on a host/host UDP pair, with sync
  in 20 ms one way and 11 ms the other.
- **Playwright** (`collab-room.spec.ts`):
  - a peer's ring is theirs (their name, one ring, in their colour);
  - others' outlines and pointers are hidden while presenting, in print and while recording, and come back after.
  - The collab specs pass: 53 of 53.
