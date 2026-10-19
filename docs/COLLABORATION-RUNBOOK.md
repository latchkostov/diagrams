# Edit together: switching it on for livediagrams.dev (owner runbook)

Edit together ships in the code (collaboration plan slices E1–E8), but it is off in the livediagrams.dev build
until the owner sets one build variable. These are the steps, and what to watch afterwards. The user-facing docs
are in [EDIT-TOGETHER.md](EDIT-TOGETHER.md).

## Before switching on

The plan's prerequisites, as they stood at switch-on (18 October 2026). The owner approved switching on that day,
after testing rooms on a production-mode preview.

- [x] **E1–E5 and E7 merged** (E7, #186, on 18 October 2026). **E8** (#187) ships alongside the switch.
- [ ] **The manual network matrix (below).** Not recorded as a table yet. The owner's preview test on 18 October
      2026 stood in for it at switch-on. Record M1–M3 when you can: they decide whether TURN is needed.
- [ ] **7 Nightly smoke nights.** The smoke started on 18 October 2026 (E6, #185), so fewer than 7 nights were
      recorded at switch-on. Keep watching it (below).
- [x] **The owner signed off** on the decisions in §2.8 of the plan, and approved switch-on (18 October 2026).
- [x] **The trackers' terms were checked** (18 October 2026). OpenWebTorrent describes its tracker as "free for anyone
      to use", with problems reported as issues on its `openwebtorrent-www` GitHub repository. webtorrent.dev describes
      its tracker as "a free-to-use, public WebTorrent tracker", running Aquatic and not associated with WebTorrent LLC.
      Neither publishes terms, usage limits or attribution requirements. Both are credited in
      [EDIT-TOGETHER.md](EDIT-TOGETHER.md#thanks). Neither lists a contact other than that, so they haven't been
      contacted ([threat model](research/collaboration-threat-model.md), residual risk 5).
- [x] **Private diagrams stay blocked.** Nothing here changes that.

The site's CSP already allows the two approved trackers (`vercel.json`, generated from
`scripts/security-headers.ts`). STUN can't be governed by CSP: it is fixed in the build. Nothing contacts any of them
until a build has rooms.

## Switch on

1. Open the Vercel dashboard, then the **diagrams** project, then **Settings ▸ Environment Variables**.
2. **Add New**: key `VITE_ENABLE_COLLAB`, value `1`. Tick **Production** (Preview builds don't deploy: only master
   does). **Save**.
3. **Deployments**: open the latest production deployment's **⋯** menu and choose **Redeploy**. Variables apply only
   to new builds.
4. Check the live site:
   - **File ▸ Share…** has **Edit together…**, after Link with password.
   - The start dialog lists `tracker.openwebtorrent.com, tracker.webtorrent.dev, stun.cloudflare.com`.
   - Two browsers (a normal and a private window will do) can start and join a room.
   - Leave works.
   - DevTools' console shows no Content-Security-Policy violation.
5. Set the privacy policy's effective date (`public/privacy.html`, `privacy-effective`) to the switch-on date. Its
   Edit together paragraph is already written. Add a release note for the switch-on: a new dated fragment in
   `docs/release-notes/`.

Leave every other collaboration variable unset. The public site uses exactly the approved trackers and Cloudflare
STUN, with no TURN. Changing that needs the owner's approval: `VITE_COLLAB_TRACKERS`, `VITE_COLLAB_STUN` and
`VITE_COLLAB_TURN` are for self-hosted copies.

## Switch off

Delete the variable (or set it to `0`) and redeploy. The next build carries no room code at all. People who were in
a room keep their copies in Your diagrams. A room link then opens nothing, because that build has no rooms.

## The manual network matrix (run once, before switching on)

The matrix shows which networks connect directly. Nothing in CI can show it: the Nightly smoke's two browsers share
one runner.

**Setup on each computer:**

1. Check out the same commit, then run `pnpm install`.
2. Build a copy with rooms and serve it:
   `VITE_ENABLE_COLLAB=1 pnpm build && pnpm exec vite preview --port 7180 --strictPort`.
3. Open `http://localhost:7180/` in Chrome, and `chrome://webrtc-internals` in another tab.

No hosting is needed. Each machine serves its own copy, and the room link is all they share: send it through any
chat, then replace its `http://localhost:7180/` part with the other machine's own address.

**Each run:**

1. Computer A: open an example, choose **File ▸ Share… ▸ Edit together… ▸ Start room**, and copy the link.
2. Computer B: open the link, choose **Join**, and start a stopwatch.
3. Record:
   - the time until the diagram shows on B, and until both chips count the other person;
   - edits both ways (rename a node, drag a node);
   - the **selected candidate pair** in `chrome://webrtc-internals`: the local and remote types (`host`, `srflx`,
     `prflx`), the protocol, and whether either side is IPv6;
   - if B hasn't connected within 60 s, the alert's text.
4. Turn off B's Wi-Fi for 20 s, then turn it back on. Record how long A takes to show "Reconnecting…", and whether
   Retry recovers.
5. Close B's tab. Record how long A takes to show "Everyone else left".
6. Repeat three times per network pair, swapping who starts the room once.

**Pairs:**

| #             | A                        | B                                                  | Why                                     |
| ------------- | ------------------------ | -------------------------------------------------- | --------------------------------------- |
| M1            | Home Wi-Fi               | Home Wi-Fi (second computer)                       | Baseline (host candidates)              |
| M2            | Home Wi-Fi               | A laptop tethered to a phone hotspot (carrier NAT) | The likeliest failure                   |
| M3            | Home Wi-Fi               | A full-tunnel VPN, or an office network            | Corporate or symmetric NAT, UDP blocked |
| M4 (optional) | Phone hotspot            | A second hotspot, or another carrier               | Carrier NAT at both ends                |
| M5 (optional) | Firefox and Safari on M1 |                                                    | Browser differences                     |

Record one table with these columns: pair, trial, who started, connected (y/n), seconds, pair type, sync both ways,
drop noticed (s), Retry recovered, notes. Add it to `docs/research/collaboration.md` as a dated section.

**When to bring the owner TURN options:**

- M2 or M3 fails in at least 2 of 3 trials; or
- the Nightly smoke keeps failing at ICE/NAT while its trackers answer.

The options are a credential worker, Cloudflare's TURN, or a self-hosted coturn. Each is a server, so each needs the
owner's explicit approval.

## Watching the Nightly smoke

The **Collaboration network smoke (report only)** job in `.github/workflows/nightly.yml` runs every night. Two
browsers start and join a room through the approved trackers and STUN, under the build's real headers. It never
fails the Nightly run.

- **Each night's table** is in the run's summary. It shows the result, the stage reached, the time to connect, the
  sync time each way, whether the peers connected, the candidate pair, and the sockets and frames per tracker. The
  trace is in the `nightly-collab-smoke` artifact.
- **The trend job** lists the last nights. After **3 failed nights in a row** it opens, or comments on, the
  `nightly-failure` issue under "Collaboration network smoke (report-only)".
- **Reading a failure:**
  - **Trackers unreachable:** no tracker answered. This is the public network or the tracker operators. If it lasts,
    check the trackers' status; changing the tracker set needs the owner's approval.
  - **ICE/NAT:** the trackers answered, but the browsers never connected. This is the network between them; see the
    TURN rule above.
  - **App error:** a page error, or a failure after the peers connected. This is a bug: open the trace.
- **Run it by hand** with the e2e build: `COLLAB_SMOKE=1 pnpm exec playwright test --project=collab-smoke`. It
  contacts the real public trackers, so never run it from PR CI.

## Coming: a relay you host

A self-hosted relay server (`services/server`, plan slices S3–S5) will let a self-hosted copy carry rooms through
its own server instead of public trackers. Its docs ship with S5. It is not part of livediagrams.dev.
