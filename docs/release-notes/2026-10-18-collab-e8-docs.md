## Edit together: docs, self-hosting and the E7 review fixes (E8)

Collaboration plan slice E8: the docs for Edit together, the self-hosting guide for its build variables, and the
owner's runbook for switching it on. Rooms stay off on livediagrams.dev until the owner sets `VITE_ENABLE_COLLAB=1`
in Vercel.

### New and updated docs

- **New user guide, `docs/EDIT-TOGETHER.md`:** starting, joining and leaving a room; presence; what each failure
  message means; and privacy. The privacy section covers end-to-end encryption, who sees your IP address,
  that nothing is sent to us, that Private diagrams stay out, the encrypted recovery copy, that anyone with the link
  can edit, and that there has been no independent cryptographic review yet.
- **New owner runbook, `docs/COLLABORATION-RUNBOOK.md`:**
  - prerequisites;
  - the Vercel variable and redeploy, then checks on the live site;
  - how to switch it off;
  - the manual network matrix, run against a local build with rooms;
  - when to bring the owner TURN options;
  - how to read the Nightly smoke.

  A self-hosted relay is noted as coming, with its docs in S5.

- **`docs/SELF-HOSTING.md` has a new Edit together section:**
  - The switch, which needs share links.
  - What a room contacts.
  - `VITE_COLLAB_TRACKERS`, `VITE_COLLAB_STUN` (or `none`) and `VITE_COLLAB_TURN`, with its username and
    credential.
  - **A warning that TURN credentials are visible to anyone who can open the page.**
  - TURN for locked-down networks, and running your own tracker.
  - Headers, Docker arguments, troubleshooting rows, and data and privacy.
- **Helm.** `values.yaml` lists the new switches. The pod's build annotation leaves out the TURN credential.
- **Privacy.**
  - `public/privacy.html` has an Edit together paragraph, and a "can't be edited together" line for Private
    diagrams. Its effective date changes at switch-on (runbook step 5).
  - `PRIVACY-AUDIT.md` has rows for rooms and room recovery, and a note on rooms and IP addresses. Its old line
    "No … IndexedDB" now describes the recovery database.
- **Threat model.** It is no longer described as Lab-only. A new section, "Production rooms (E1–E8)", covers the
  switch, build-time endpoints, CSP, IP disclosure, TURN credentials, Private diagrams staying blocked, presence,
  storage, the missing crypto review and monitoring.
- **`collaboration.md`** gains a production status paragraph: no beta, graceful failure, and TURN only after evidence
  and with the owner's approval.
- **README** has an Edit together feature line and the two new docs.

### E8 review fixes

- **Own endpoints don't confine peers.** SELF-HOSTING no longer says a room "contacts nothing outside your network".
  Your own trackers, STUN and TURN remove the dependency on public matchmaking and public ICE services. But browsers
  still try every address a peer advertises, and TURN doesn't force relay-only connections. Keeping peer traffic
  inside a network needs egress controls. The threat model and the endpoints module say the same.
- **Configured providers, through the default path.** A test sets the provider variables and reads each config with
  no arguments, the way the app does at startup. It checks every value and all three registry entries. Removing a
  key from the config's named list fails it.

### E7 review fixes

- **Tracker URLs are canonical.** `WSS://T.example.com` becomes `wss://t.example.com/`, and `ws://localhost` becomes
  `ws://localhost/`. Before, the transport silently skipped those spellings even though the build had accepted
  them. A test checks that the transport opens every accepted spelling.
- **Endpoints stay out of `import.meta.env`.** The build drops the `VITE_COLLAB_*` variables from Vite's environment
  object. The storage providers' config now reads its own keys by name instead of reading the whole object. A
  build-test check failed without these fixes: a copy's trackers and TURN credential reached the startup code, even
  in a build without rooms. Now they appear only in the room's own chunk.
- **Build fixtures are isolated.** Both build-test suites share `src/test/productionBuild.ts`. It clears every
  deployment variable and reads no `.env` file, so a checkout configured for its own copy still tests the defaults.
  This is checked by building with ambient collaboration settings set.
- **Disclosure works for any endpoints.** "The services below, which introduce you to the others, see your IP
  address too…" replaces "Two public matchmaking services, run by other people…". The e2e checks both dialogs with
  a single tracker the test runs itself.
- **Native sockets obey `connect-src`.** A new `csp.spec` test uses a real WebSocket server and nothing emulated.
  The app's policy with the tracker's source admits the handshake. The same policy without it, or an embed's policy,
  blocks the socket before any handshake.

### Verification

- **Unit tests:** the full suite passes; the suites that timed out under load pass in isolation. The privacy page's
  pinned markup hash (`src/static/pages.build.test.ts`) is updated for its new paragraphs.
- **Build tests:** the bundle and deployment build tests pass, 48 of 48.
- **E2E:** `csp`, the collab specs, `privacy-audit` and `brand` pass, 86 of 86. The internal, locked and subpath
  projects pass, 23 of 23.
- **Helm:** `helm lint` passes, and `helm template` with a TURN credential set leaves it out of the annotation.
