# Collaboration threat model (C0)

Written **16 October 2026** for collaboration phase C0, the browser proof that
[collaboration.md](collaboration.md) proposes. It describes what the code in `src/collab/` does and what it does not
do. C0 is **Lab-only**: the dev server and the e2e build have it behind the Lab's `collab-c0` preset, and a
production build contains none of it (`canCollaborate()` in `src/lib/localOnly.ts` is false there, and
`src/lib/bundleSplit.build.test.ts` keeps `src/collab/` and Yjs out of the startup JavaScript). Nothing here is a
user-facing promise yet. An independent cryptographic review is still needed before any Private-diagram guarantee.

## Scope and trust boundary

- **Trusted:** the person's own browser and the static app it runs (the publisher of the JavaScript). A malicious
  build, a compromised browser or an extension reads everything in the page, keys and diagram included. End-to-end
  encryption does not change that; a pinned self-hosted copy narrows who can change the code.
- **Room members:** whoever holds the room link. Each can read the diagram and write to it, keep copies, forward
  the link and show their screen. C0 rooms have one role (edit); a member cannot be removed without a new room.
- **Untrusted for content:** the network, the in-memory or WebRTC transport, public matchmaking (BitTorrent
  trackers in the spike), STUN, any future TURN or relay, and the static host serving the page.

## Assets

| Asset                                | Why it matters                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Diagram content                      | Labels, structure, simulation and planning settings can describe a real system.         |
| The room secret and the keys from it | Whoever has the secret reads and writes the room.                                       |
| Presence                             | Aliases, colours and status are personal-ish and say who is present when.               |
| Metadata                             | IP addresses, timing, room membership, message sizes.                                   |
| Local Private provenance             | The `private` flag promises a diagram never leaves the device.                          |
| Integrity of the shared document     | A converged room must not silently lose or corrupt work.                                |
| Local editing availability           | A hostile peer must not be able to freeze or crash the tab or break ordinary local use. |

## What C0 builds (protocol summary)

- **Link** (`link.ts`): `https://<app>/#room=v1.<epoch>.<secret>`, the secret 32 random bytes in canonical,
  unpadded base64url. Only the fragment carries it. Parsing is strict and bounded; a secret in the query string, a
  repeated `room`, or `room` beside `#d=`/`#e=` is refused; error messages never echo the secret. The page reads
  the fragment and removes it at once with `history.replaceState` (`consumeRoomFragment`).
- **Keys** (`keys.ts`): HKDF-SHA-256 (WebCrypto), salt and info domain-separated per purpose and epoch: a public
  room id, a separate 20-byte tracker discovery hash, a signalling key, and per-channel bases (document, presence).
  Every key is non-extractable. No primitive of our own.
- **Envelope** (`envelope.ts`): AES-256-GCM under a per-sender subkey (HKDF of the channel base with the sender's
  random 16-byte session id). The 32-byte header (magic, version, channel, epoch, sender, 64-bit counter) and the
  room id are the additional data. The IV is the counter, unique because each session's subkey is its own and its
  counter only grows, across reloads and tabs alike. Openers check length, magic, version, channel, epoch, reflection,
  the sender cap and the replay window before decrypting, and record the counter only after GCM authenticates.
- **Document** (`schema.ts`, `commands.ts`, `doc.ts`): Yjs maps keyed by stable ids, atomic geometry and edge ends,
  per-key props, list order as arrays, deterministic projection back to a `DiagramFile` checked by the import
  validator. The command adapter is the only writer; Y.UndoManager tracks only the person's own origin.
- **Session** (`session.ts`): state-vector anti-entropy (no forwarding), presence on its own channel, refusals counted
  by reason, quarantine of a member whose authenticated update the guard refuses.
- **Transports** (`transport/`): one interface, an in-memory network with seeded faults, a conformance harness, and
  the spike's tracker/WebRTC adapter.

## What each party sees

Measured for the spike with `scripts/collab-spike-capture.mjs` (16 October 2026: two isolated Chromium profiles on
the dev server, public trackers and Cloudflare STUN; see [Spike results](#public-matchmaking-spike-results)) and in
CI with the offline capture in `src/collab/transport/tracker.test.ts`.

| Observer                              | Sees                                                                                                                                                                                         | Never sees                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Static host (our site or a self-host) | Page and chunk requests, IP, user agent. Not the fragment (browsers don't send it).                                                                                                          | The room secret, the diagram.                                                              |
| BitTorrent tracker (spike)            | IP and timing; `info_hash` (the room's discovery hash); random `peer_id` and `offer_id`; offers/answers as `ld1.<ciphertext>`; message counts and sizes; which peers announce the same hash. | The secret, any key, SDP, ICE candidates (and the IPs inside them), the diagram, presence. |
| STUN                                  | The caller's address.                                                                                                                                                                        | Anything else.                                                                             |
| TURN (not in C0)                      | Both endpoints' addresses, timing, byte counts.                                                                                                                                              | Content (DTLS plus our envelopes).                                                         |
| A peer over WebRTC                    | Everything a member sees, plus the other peer's IP on a direct path.                                                                                                                         | Nothing is hidden from a member except other rooms.                                        |
| A network observer                    | Encrypted WebRTC/WSS traffic, endpoints, timing, sizes.                                                                                                                                      | Content.                                                                                   |
| A member                              | The diagram, presence, every session id in the room.                                                                                                                                         | The local `private` flag, other people's views, selections and inspectors.                 |

## Attacks and mitigations

| Attack                                                                                                                                                                                         | Mitigation in C0                                                                                                                                                                                                                                                                       | Test                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Tampering with a frame (ciphertext, tag, header, channel, counter)                                                                                                                             | GCM over ciphertext with the header and room id as additional data; per-sender subkeys bind the sender id; the counter is the IV.                                                                                                                                                      | `envelope.test.ts`                                                                                         |
| A frame from another room or with the wrong key                                                                                                                                                | Different HKDF outputs; `auth-failed`, counted, ignored.                                                                                                                                                                                                                               | `envelope.test.ts`, `session.test.ts`                                                                      |
| Replay (a network re-sending everything it saw)                                                                                                                                                | A 1,024-wide replay window per sender and channel; stale counters refused; only authenticated counters move it.                                                                                                                                                                        | `envelope.test.ts`, `session.test.ts` ("a network replaying every frame")                                  |
| Reflection of one's own frames                                                                                                                                                                 | A frame claiming one's own sender id is refused.                                                                                                                                                                                                                                       | `envelope.test.ts`                                                                                         |
| An old (or future) key epoch                                                                                                                                                                   | The header epoch must equal the room's; the epoch is also in the key schedule, so relabelling fails authentication.                                                                                                                                                                    | `envelope.test.ts`, `session.test.ts`                                                                      |
| Forged frames under made-up sender ids (state exhaustion)                                                                                                                                      | A sender occupies a slot (and a cached subkey) only after a frame authenticates; at most 64 senders.                                                                                                                                                                                   | `envelope.test.ts`                                                                                         |
| Hostile Yjs updates from a member: size, struct/client/deletion counts, huge clocks, unknown roots, subdocuments, text/XML/binary/embed/format content, over-long strings or keys, deep values | `guard.ts` decodes and checks every update **before** applying it, using only the update's bytes, so all honest peers refuse the same update alike and stay converged. The sender is quarantined for the session.                                                                      | `doc.test.ts`, `session.test.ts`                                                                           |
| Valid-but-wrong shapes (a node that isn't a map, a field of the wrong type)                                                                                                                    | The projection reads typed fields only; a record without what it needs is hidden (and kept); the import validator decides the rest.                                                                                                                                                    | `doc.test.ts`                                                                                              |
| State-dependent overflow: concurrent additions past 5,000 nodes, dangling references                                                                                                           | Never "repaired" by truncation. The projection is deterministic, so every peer reports the same invalid state; the last valid diagram stays on screen; the records stay for a recovery export. Edges whose end was deleted concurrently are hidden, not deleted.                       | `doc.test.ts`                                                                                              |
| Concurrent Undo leaving a field empty (Yjs refuses a redo that conflicts with someone else's change)                                                                                           | Incomplete records are hidden deterministically and listed (`Projection.hidden`), never shown half-built. C1 should offer a "restore" action.                                                                                                                                          | seeded convergence (`conformance.ts`)                                                                      |
| Vandalism by a member                                                                                                                                                                          | Not preventable in a one-role room: a member can delete everything. Per-person Undo cannot undo someone else's work. Leaving keeps a local copy; C2 adds roles and signed grants.                                                                                                      | —                                                                                                          |
| A member impersonating another member's session                                                                                                                                                | Possible: the channel keys are shared, so any member can derive any sender's subkey. The envelope proves "some member", not who. Presence aliases are labelled unverified. C2: per-session signing keys endorsed by owner-signed grants.                                               | —                                                                                                          |
| Flooding (frames, sync requests, presence)                                                                                                                                                     | Frame size caps per channel before decrypting; a 64 MiB/10 s token bucket per sender on document frames; a 16 MiB/10 s cap on sync replies per requester; presence capped at 64 entries with expiry.                                                                                   | `session.test.ts`                                                                                          |
| Malicious presence (alias spoofing with control or bidi characters)                                                                                                                            | Exact schema, 40 characters, control and bidi-override characters stripped, colour index bounded.                                                                                                                                                                                      | `session.test.ts`                                                                                          |
| Key leakage via Referer                                                                                                                                                                        | Browsers never send the fragment as Referer; Referrer-Policy is `strict-origin-when-cross-origin` (header and `<meta>`), so other origins don't even get the path.                                                                                                                     | `policy.test.ts`                                                                                           |
| Key leakage via the query string, server logs, analytics                                                                                                                                       | The key is never put in a query; a link that does is refused (and removed from the address bar), because a server has already logged it. The app has no analytics.                                                                                                                     | `link.test.ts`, `policy.test.ts`                                                                           |
| Key leakage via the address bar, bookmarks, copied URLs, history                                                                                                                               | The fragment is removed with `replaceState` as soon as it's read. The browser's history database may still hold the original URL, and chat apps may preview it: a mitigation, not erasure.                                                                                             | `link.test.ts`, spike capture (address bar cleared)                                                        |
| Key leakage via error messages and logs                                                                                                                                                        | Errors never include the secret; no code logs keys or payloads; spike diagnostics are event names only.                                                                                                                                                                                | `link.test.ts`                                                                                             |
| Key leakage via signalling                                                                                                                                                                     | Trackers get the discovery hash, never the secret; SDP is encrypted under a signalling key that opens nothing else, bound to the direction and offer id.                                                                                                                               | `tracker.test.ts` (offline capture), spike capture                                                         |
| Room-id linkability                                                                                                                                                                            | Room ids and discovery hashes are HKDF outputs per room and epoch: two rooms (or two epochs) can't be linked by them. Within a room, a tracker can link everyone announcing the same hash, and IPs and timing link sessions. A new room or epoch gives new ids.                        | `envelope.test.ts`                                                                                         |
| SDP swapping or cross-room offers on a shared tracker                                                                                                                                          | Offers and answers authenticate under the room's signalling key with the offer id and direction as additional data; anything else is ignored.                                                                                                                                          | `tracker.test.ts`                                                                                          |
| Tracker-level denial of service, a dead tracker, a hostile tracker                                                                                                                             | No defence against availability: public infrastructure can drop, delay or withhold. Several trackers are announced to; the spike saw one of three dead. A hostile tracker learns only metadata.                                                                                        | spike                                                                                                      |
| A Private diagram joining a room                                                                                                                                                               | `CollabSession.open` refuses when `canCollaborate()` is false (Private, local-only, links off, production) or the diagram says `private`; the binding leaves the room, sending nothing, the moment the diagram turns Private; `private` is never written to or read from shared state. | `session.test.ts`, `doc.test.ts`, e2e                                                                      |
| Collaboration code or traffic during ordinary local use                                                                                                                                        | Nothing loads or connects until a room is started; Yjs and `src/collab/` are a lazy chunk; production has none of it; the CSP's `connect-src` allows no tracker, socket or STUN endpoint.                                                                                              | `collab-c0.spec.ts` ("local use makes no network requests"), `policy.test.ts`, `bundleSplit.build.test.ts` |

## Bounds

All in `src/collab/limits.ts`: document frames 8 MiB (a full 5,000-node room is about 2 MB), presence frames 4 KiB,
64 senders, a 1,024-counter replay window, 1,000,000 structs and 100,000 clients per update, clocks below 2^30,
strings below 100,000 characters, field names below 256, JSON values 32 levels deep, 64 MiB per sender and 16 MiB of
replies per requester per 10 s, presence expiry after 30 s (heartbeat 10 s), anti-entropy every 5 s, and a counter
ceiling of 2^48 per session.

## Public matchmaking spike results

Run with `node scripts/collab-spike-capture.mjs` on 16 October 2026 against the dev server, using the spike's
defaults (`wss://tracker.webtorrent.dev`, `wss://tracker.openwebtorrent.com`, `wss://tracker.btorrent.xyz`,
`stun:stun.cloudflare.com:3478`):

- **It worked.** Two isolated browser profiles found each other and opened a WebRTC data channel in about 3 to 4
  seconds, synced the creator's diagram and then edits both ways.
- `tracker.btorrent.xyz` failed to connect; the other two answered. Public tracker availability is a real risk.
- 18 tracker frames were captured. Fields seen: `action`, `info_hash`, `peer_id`, `numwant`, `uploaded`,
  `downloaded`, `offers`/`offer_id`/`offer`, `answer`, `to_peer_id`, and the tracker's `interval`, `complete`,
  `incomplete`.
- **No leak:** zero frames contained the room secret (base64url or hex), the canary title, or SDP plaintext
  (`v=0`, `ice-ufrag`, `fingerprint:`, `candidate:`). The guest's address bar no longer held the key once read.
- Both peers ran on one machine, so this says nothing about NAT traversal between networks, corporate firewalls or
  how often TURN would be needed. That needs the C1 beta's measurements.

## Residual risks and open items for C1

1. **Independent review** of the key schedule, envelope and link format before any Private-diagram promise.
2. **Roles and attribution:** one shared key means any member can write and impersonate another session. C2's
   signed grants and per-session signing keys address it.
3. **Removal and rotation:** the epoch field and per-epoch keys are in place; the transition (new generation from
   the visible state, fresh links, refusing old-epoch writes) is not built. End session is not built.
4. **IP exposure:** peers see each other's IPs on direct paths, trackers see everyone's. C1 must disclose it before
   joining; a TURN-only mode needs a TURN service with safe credentials (an owner decision).
5. **Public infrastructure terms and availability:** check each tracker's terms, contact operators, credit them,
   respect announce intervals, and add their hosts to `connect-src` only for builds that enable collaboration.
6. **Local recovery:** C0 keeps the document in memory only. C1 needs IndexedDB per room and generation, and "Saved on
   this device" versus "Connected and synced" states.
7. **Editor binding:** C1 wires `EditorBinding.localChanged` to the editor's history commit, routes Undo/Redo to the
   session in a room, and generates session-unique ids for new elements (`RoomClient.newId`), so two people adding
   at once never collide.
8. **Labels as collaborative text** (Y.Text) and movable list order remain C1 or later decisions; C0 uses
   last-writer-wins fields and arrays with deterministic de-duplication.

## C0 measurements

Operation counts, bytes and same-run growth ratios (`src/collab/scale.test.ts`; `COLLAB_SCALE_LOG=1` and
`GROWTH_LOG=1` print them), never milliseconds. Sizes are 625 and 5,000 nodes from the benchmark generators.

- A full 5,000-node room's state is 2.07 MB (service mesh, 8,281 edges) or 1.90 MB (boundaries and annotations):
  one document frame.
- One edit is one command, a 25 to 26-byte update at either size, and one record re-read on the receiver.
- A committed move adds about 11 bytes to the document.
- Growth from 625 to 5,000 nodes (linear is about 8, the limit 24): hydrate 8.7 to 11, diff and apply 9.5 to 9.9,
  joining sync 7.4 to 11.7, projection 7.6 to 9.1, deleting every node 7.2 (it was 50.6 before deleting order
  entries as runs, which the test now guards).
- Churn: each short-lived editor adds about 3 bytes to the state vector and 14 bytes to the document.
- Lazy bytes: the Lab's collaboration chunk (Yjs, lib0, `src/collab/` and the Lab panels) is 133.1 kB raw,
  41.4 kB gzip, loaded only when the preset opens. Production builds contain none of it; the entry chunk stays
  105.7 kB gzip against its 123.5 kB budget.
