## Edit together: the production switch, its CSP and the bundle checks (E7)

Collaboration plan slice E7. Edit together can now ship in a production build, but only when that build asks for
it.

- **The switch.** `VITE_ENABLE_COLLAB=1` turns on Edit together (rooms) in a production build. It follows the same
  pattern as `VITE_PRIVATE_BY_DEFAULT`: `scripts/deployment-env.ts` reads it, it becomes the `__DEPLOYMENT_COLLAB__`
  build constant, and `src/lib/deployment.ts` exports it as `COLLAB`.
  - It is off by default, so a self-hosted copy has no rooms unless it sets it.
  - It never takes effect without share links: `canCollaborate = (COLLABORATION_LAB || COLLAB) && SHARE_LINKS &&
!isLocalOnly`.
  - Without the switch, the bundler drops the room code entirely, Yjs included.
  - Share's Edit together row, Ctrl+K and room links all follow the same `ROOMS` gate.
  - Development and e2e builds keep rooms whatever the switch says.
- **Endpoints, fixed at build time.**
  - **Defaults.** With nothing set, a room uses the approved set: `wss://tracker.openwebtorrent.com`,
    `wss://tracker.webtorrent.dev` and `stun:stun.cloudflare.com:3478`, with no TURN. `policy.test.ts` checks this
    against the transport's constants.
  - **A self-hosted copy's own endpoints** (Q9) come from `VITE_COLLAB_TRACKERS`, `VITE_COLLAB_STUN` (or `none`)
    and `VITE_COLLAB_TURN` with its username and credential. All of them are validated, so a typo stops the build.
  - **Where they're read.** The endpoints are defined only in the room's own chunk
    (`src/collab/room/endpoints.ts`), never at startup.
  - **The consent dialogs** now list the hosts this build actually contacts, instead of a fixed list.
- **CSP.** `cspDirectives({ embed, collab })` adds the trackers' origins to `connect-src`, but never for an embed.
  - **livediagrams.dev.** `vercel.json` and `vite preview` now allow exactly the two approved trackers for the app.
    Embeds are unchanged.
  - **STUN and TURN** aren't fetches, so CSP can't govern them; the build-time list is their allowlist.
  - **Self-hosted copies.** `headers.json` and `pnpm headers:self-host` follow the build's own variables. With the
    switch on, the copy's trackers join the app's `connect-src`. The samples in `deploy/self-host/` are unchanged,
    because the switch is off there.
- **Docker.** The Dockerfile and `docker-compose.yml` pass the new variables as build arguments, and a unit test
  checks that every deployment variable is passed.
- **E6 review fixes.**
  - The smoke now runs under the build's real headers; the CSP bypass is gone.
  - `COLLAB_SMOKE=1` defaults to the e2e build and refuses a dev target, so it no longer starts with no server.
  - Sync timing starts at the edit itself rather than after it.
  - A failure after the peers connected (the document never arrived) is now classed as an app error, not ICE/NAT.
- **Turning it on for livediagrams.dev** is a Vercel setting: add `VITE_ENABLE_COLLAB=1` to the project's
  environment variables, then redeploy. Merging this PR changes only the site's CSP, which gains the two trackers;
  nothing contacts them until the switch is on.

## Verification

- **`bundleSplit.build.test.ts`** makes two builds.
  - **Off:** no collaboration code, no Yjs and no endpoints in any chunk.
  - **On:** rooms and Yjs are present, but not at startup (the same pinned startup chunks) and not in the canvas's
    first view. The endpoints appear in exactly one lazy chunk, which holds `endpoints.ts`, and are exactly the
    approved trackers and STUN, with no TURN.
- **`deployment.build.test.ts`:**
  - The public and locked builds carry no room code.
  - With the switch on but share links off, there is still no room code.
  - A copy's own trackers, STUN and TURN replace the approved ones.
- **`policy.test.ts`** checks `connect-src`:
  - in a rooms build, it is exactly the approved trackers;
  - in an embed, or a build without rooms, it has no socket at all;
  - it never names STUN or TURN;
  - livediagrams.dev's headers allow the trackers for the app but not for embeds.
- **Unit tests** cover parsing (trackers, STUN, `none`, TURN with its credentials), the self-host headers with
  rooms, the hosts the consent dialogs list, and the smoke's classifier and timing.
- **`csp.spec.ts`**: two browsers meet through the approved tracker URLs under the real headers, with zero
  violations. The trackers are answered in the test runner. Any other tracker is refused. With the trackers taken
  out of the policy, the test fails.
- **E2E runs:**
  - `collab-room` and `csp`: 33 of 33 passed.
  - The internal, locked and subpath projects: 23 of 23 passed.
  - The real-network smoke, run locally under the real CSP with no target set: passed. It connected in 2.9 s, with
    sync of 68 ms one way and 80 ms the other.
