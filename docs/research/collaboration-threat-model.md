# Collaboration threat model (C0)

Written **16 October 2026** for collaboration phase C0, the browser proof that
[collaboration.md](collaboration.md) proposes. It describes what the code in `src/collab/` does and what it does not
do. C0 was **Lab-only**. Since the production slices (E1–E8, October 2026), rooms are a production feature behind the
build switch `VITE_ENABLE_COLLAB` (off unless set). A build without it contains none of the code
(`src/lib/bundleSplit.build.test.ts`, `src/lib/deployment.build.test.ts`). See
[Production rooms](#production-rooms-e1e8-2026-10-18) for what changed. An independent cryptographic review is still
needed before any Private-diagram guarantee, and Private diagrams stay out of rooms until then.

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

| Attack                                                                                                                                                                                         | Mitigation in C0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Test                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Tampering with a frame (ciphertext, tag, header, channel, counter)                                                                                                                             | GCM over ciphertext with the header and room id as additional data; per-sender subkeys bind the sender id; the counter is the IV.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `envelope.test.ts`                                                                                         |
| A frame from another room or with the wrong key                                                                                                                                                | Different HKDF outputs; `auth-failed`, counted, ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `envelope.test.ts`, `session.test.ts`                                                                      |
| Replay (a network re-sending everything it saw)                                                                                                                                                | A 1,024-wide replay window per sender and channel; stale counters refused; only authenticated counters move it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `envelope.test.ts`, `session.test.ts` ("a network replaying every frame")                                  |
| Reflection of one's own frames                                                                                                                                                                 | A frame claiming one's own sender id is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `envelope.test.ts`                                                                                         |
| An old (or future) key epoch                                                                                                                                                                   | The header epoch must equal the room's; the epoch is also in the key schedule, so relabelling fails authentication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `envelope.test.ts`, `session.test.ts`                                                                      |
| Forged frames under made-up sender ids (state exhaustion)                                                                                                                                      | A sender occupies a slot (and a cached subkey) only after a frame authenticates; at most 64 senders.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `envelope.test.ts`                                                                                         |
| Hostile Yjs updates from a member: size, struct/client/deletion counts, huge clocks, unknown roots, subdocuments, text/XML/binary/embed/format content, over-long strings or keys, deep values | `guard.ts` decodes and checks every update **before** applying it, using only the update's bytes, so all honest peers refuse the same update alike and stay converged. The sender is quarantined for the session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `doc.test.ts`, `session.test.ts`                                                                           |
| Valid-but-wrong shapes (a node that isn't a map, a field of the wrong type)                                                                                                                    | The projection reads typed fields only; a record without what it needs is hidden (and kept); the import validator decides the rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `doc.test.ts`                                                                                              |
| State-dependent overflow: concurrent additions past 5,000 nodes, dangling references                                                                                                           | Never "repaired" by truncation. The projection is deterministic, so every peer reports the same invalid state; the last valid diagram stays on screen; the records stay for a recovery export. Edges whose end was deleted concurrently are hidden, not deleted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `doc.test.ts`                                                                                              |
| Concurrent Undo leaving a field empty (Yjs refuses to restore a value when someone else wrote that field meanwhile, even if their value has since been overwritten too)                        | After each Undo or Redo, a field the step replaced that is now empty gets back the value the step meant to restore, written as an ordinary change and recorded as part of that Undo, so Redo still works. Records still incomplete after concurrent Undos by two people are hidden deterministically (`Projection.hidden`), never shown half-built.                                                                                                                                                                                                                                                                                                                                                                                                                | `doc.test.ts`, seeded convergence (`conformance.ts`)                                                       |
| Vandalism by a member                                                                                                                                                                          | Not preventable in a one-role room: a member can delete everything. Per-person Undo cannot undo someone else's work. Leaving keeps a local copy; C2 adds roles and signed grants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —                                                                                                          |
| A member impersonating another member's session                                                                                                                                                | Possible: the channel keys are shared, so any member can derive any sender's subkey. The envelope proves "some member", not who. Presence aliases are labelled unverified. C2: per-session signing keys endorsed by owner-signed grants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                          |
| An honest edit the room would refuse (a value too long or too deep, or a step too large once encoded)                                                                                          | Local steps and the creator's initial copy are checked against the same bounds before they touch the document, including an upper bound on the step's encoded size computed the way Yjs and lib0 encode it (UTF-8 strings, 8-byte numbers, one item per field, props key and order entry); a refused step is reverted in the editor, shown to the person and never sent, so peers never quarantine an honest person.                                                                                                                                                                                                                                                                                                                                               | `session.test.ts`, `guard.test.ts`                                                                         |
| Two people creating elements with the same id                                                                                                                                                  | New ids carry the session's random sender id and a counter, never the alias or a counter alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `session.test.ts`                                                                                          |
| Large rooms, long histories and hostile fragments                                                                                                                                              | A document message larger than 1 MiB travels as 1 MiB fragments, each sealed and replay-checked on its own, so frames stay small. Reassembly checks every header field against the others and the limits, reserves the whole message's length against per-sender (32 MiB) and total (64 MiB) budgets before keeping any part, holds at most 4 half-delivered messages per sender and releases them on the room clock. A sync reply past 32 MiB is split by Yjs client. Each person's Undo history is bounded (8 MiB, 500 steps: older steps are dropped and what they kept is garbage collected), and a local step that would take the room past a soft 16 MiB is refused, so honest rooms stay joinable; a size measurement is reused until the document changes. | `protocol.test.ts`, `session.test.ts`, `doc.test.ts`                                                       |
| Flooding (frames, sync requests, presence)                                                                                                                                                     | Frame size caps per channel before decrypting; queued input bounded (48 MiB in total, 24 MiB per transport peer) before decrypting; a 64 MiB/10 s token bucket per sender on document frames; 12 sync requests per requester per 10 s, refused before any encoding; 16 MiB/10 s of sync replies per requester; presence capped at 64 entries with expiry. A failure while handling one frame never stops the next, and leaving never waits for queued input.                                                                                                                                                                                                                                                                                                       | `session.test.ts`                                                                                          |
| Malicious presence (alias spoofing with control or bidi characters)                                                                                                                            | Exact schema, 40 characters, control and bidi-override characters stripped, colour index bounded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `session.test.ts`                                                                                          |
| Key leakage via Referer                                                                                                                                                                        | Browsers never send the fragment as Referer; Referrer-Policy is `strict-origin-when-cross-origin` (header and `<meta>`), so other origins don't even get the path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `policy.test.ts`                                                                                           |
| Key leakage via the query string, server logs, analytics                                                                                                                                       | The key is never put in a query; a link that does is refused (and removed from the address bar), because a server has already logged it. The app has no analytics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `link.test.ts`, `policy.test.ts`                                                                           |
| Key leakage via the address bar, bookmarks, copied URLs, history                                                                                                                               | The fragment is removed with `replaceState` as soon as it's read. The browser's history database may still hold the original URL, and chat apps may preview it: a mitigation, not erasure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `link.test.ts`, spike capture (address bar cleared)                                                        |
| Key leakage via error messages and logs                                                                                                                                                        | Errors never include the secret; no code logs keys or payloads; spike diagnostics are event names only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `link.test.ts`                                                                                             |
| Key leakage via signalling                                                                                                                                                                     | Trackers get the discovery hash, never the secret; SDP is encrypted under a signalling key that opens nothing else, bound to the direction and offer id.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tracker.test.ts` (offline capture), spike capture                                                         |
| Room-id linkability                                                                                                                                                                            | Room ids and discovery hashes are HKDF outputs per room and epoch: two rooms (or two epochs) can't be linked by them. Within a room, a tracker can link everyone announcing the same hash, and IPs and timing link sessions. A new room or epoch gives new ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `envelope.test.ts`                                                                                         |
| SDP swapping, cross-room offers, offers replayed under another peer id, forgeries reusing an offer id, offer floods                                                                            | Offers and answers authenticate under the room's signalling key with the direction, offer id and the signer's tracker peer id as additional data; each authenticated offer is considered once; the peer budget is checked again after every await.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `tracker.test.ts`                                                                                          |
| Tracker-level denial of service, a dead tracker, a hostile tracker                                                                                                                             | No defence against availability: public infrastructure can drop, delay or withhold. Several trackers are announced to; the spike saw one of three dead. A hostile tracker learns only metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | spike                                                                                                      |
| A Private diagram joining a room                                                                                                                                                               | `CollabSession.open` refuses when `canCollaborate()` is false (Private, local-only, links off, production) or the diagram says `private`; the binding leaves the room, sending nothing, the moment the diagram turns Private; `private` is never written to or read from shared state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `session.test.ts`, `doc.test.ts`, e2e                                                                      |
| Collaboration code or traffic during ordinary local use                                                                                                                                        | Nothing loads or connects until a room is started; Yjs and `src/collab/` are a lazy chunk; production has none of it; the CSP's `connect-src` allows no tracker, socket or STUN endpoint.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `collab-c0.spec.ts` ("local use makes no network requests"), `policy.test.ts`, `bundleSplit.build.test.ts` |

## Bounds

All in `src/collab/limits.ts`: document frames of one 1 MiB fragment (plus headers); whole document messages of
32 MiB (a full 5,000-node room is about 2 MB; a larger sync reply is split by Yjs client); half-delivered messages
reserved at their whole length, at most 4 and 32 MiB per sender and 64 MiB in total, released after 30 s on the room
clock; presence frames 4 KiB; 64 senders; a 1,024-counter replay window; 1,000,000 structs and 100,000 clients per
update; clocks below 2^30; strings below 100,000 characters; field names below 256; JSON values 32 levels deep; a
local step of at most 4 MiB encoded (an upper bound); a soft room bound of 16 MiB encoded (concurrent steps may
overshoot it; joining still works up to the message bound); an Undo history of 8 MiB and 500 steps per session; 48 MiB
of queued input (24 MiB per transport peer); 64 MiB per sender, 12 sync requests and 64 MiB of replies per requester
per 10 s; presence expiry after 30 s (heartbeat 10 s); anti-entropy every 5 s; and a counter ceiling of 2^48 per
session.

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

## C1a editor and local recovery (2026-10-16)

C1a binds the real canvas history commit to field-level room commands. Room edits commit after their
render, excluding active drags/resizes; those gestures defer remote projection until their final commit.
Scoped room Undo replaces snapshot Undo. A remote baseline retains selection, unchanged element identities
and property-field focus, and deleting the focused target returns focus to the canvas with an announcement.
The native canvas round-trip's defaults are normalized before diffing, never published as another person's edit.
Ordinary local history, local autosave identities and the native output pipeline are unchanged.

Recovery is opt-in at the room-session boundary, after the existing privacy/deployment gate, before transport
subscription. IndexedDB database `livediagrams-collab-recovery-v1` contains one CRDT binary checkpoint per
public derived room id and generation. It never stores a room secret, link, title, native diagram, provider
token, alias or Undo stack. A new HKDF purpose `storage`, with the existing versioned salt/info and epoch,
derives a non-extractable AES-256-GCM key independent of all wire/signalling keys. Each write draws a fresh
96-bit WebCrypto IV; additional authenticated data binds storage version, room id and generation. The app
holds the capability only in memory: reopening requires the original recovery link. The Lab offers an explicit
copy action (with a selectable fallback) and consumes/scrubs a supplied fragment, including same-page links.
No account can recover a missing key. Browser history, clipboard and other same-origin JavaScript remain
part of the existing capability-link risk; ciphertext at rest does not protect against a compromised app/browser.

Concurrent tabs read/decrypt/guard-check and merge a changed checkpoint before an atomic IndexedDB
compare-and-swap. A losing writer retries; a known authenticated checkpoint token avoids decoding our own
previous write. Eviction reads a separate, atomically maintained metadata store rather than other rooms'
ciphertext; the schema upgrade preserves existing checkpoints. Checkpoints preserve Yjs identities and tombstones. Encryption failure, blocked storage or
quota exhaustion keeps edits in memory and exposes a file-copy action; a successful save is acknowledged
only after the IDB transaction completes. Asynchronous encryption/IDB cannot promise to survive closing a tab
before that acknowledgement. A damaged/authentication-failing/guard-invalid record is removed conditionally
by token, so a concurrent replacement is not deleted. A guard-valid CRDT whose native projection is invalid
is retained, with the last valid canvas and a raw recovery export; it is not classified as corrupt.
Accumulated checkpoints have their own cardinality limits (4 million structs, 1 million clients and
4 million delete ranges) within the same 32 MiB encoded/schema bounds. Each checkpoint is checked before
acknowledging a save. A resource-limit refusal retains the authenticated record and reports unavailable
recovery; it is not deleted as corruption. Wire-update limits remain unchanged.

### Recovery invariants

- **A complete base, then ordered deltas.** Every attachment first saves the entire supplied CRDT,
  including edits made before recovery was attached. Only its durable acknowledgement permits journal
  appends. Checkpoints retain Yjs client identities, clocks and tombstones; native JSON is never their base.
- **Atomic storage and acknowledgement.** The checkpoint, metadata/head, journal and evictions share
  one IndexedDB transaction. An append advances the head in the same transaction as its ordered chunk;
  compaction replaces the base and removes the covered journal atomically. Compare-and-swap retries merge
  other writers first. Only `oncomplete` acknowledges durability, never an individual request's success.
- **Authenticated reads, including external tails.** Cursors name a checkpoint and journal position.
  A changed checkpoint requires a full read. Both paths authenticate/decode and apply the same schema and
  resource checks before applying bytes to the live document. Verified corruption conditionally removes
  only the returned token; a racing replacement survives and is merged on retry. A damaged journal falls
  back to its last valid base checkpoint, preserving live edits, then requires a replacement checkpoint.
  Newer damaged journal edits may be missing; the UI offers peer recovery or a file copy. A damaged base
  cannot be recovered from dependent deltas alone. Resource-limit failures retain records and report
  unavailable storage, rather than deleting otherwise authenticated work. A full read decrypts its
  base once, validates it for fallback, and merges its retained bytes with decrypted journal entries.
- **Bounded pending memory.** Pending plaintext deltas occupy at most 256 KiB and 128 entries. Overflow
  discards redundant deltas and marks a full checkpoint required; it never merges a growing backlog in
  the synchronous update listener. Storage failure also clears that backlog and requires a checkpoint on
  retry. The live CRDT remains the source of truth. At most one bounded encode/encrypt/write job is in
  flight, in addition to the bounded queue; document, checkpoint and ciphertext limits still apply.
  After a checkpoint captures its revision, later deltas queue within the same bounds and append only
  once that base is durable. Overflow invalidates that capture; a rejected base must be recaptured too.
- **Failure retry schedule.** A failed save retries on the session clock after 1, 2, 4, 8, 16, then
  30 seconds, capped at 30 seconds without jitter. Typing and ordinary flush calls cannot bypass that
  timer or grow a delta backlog while a fresh checkpoint is required. A successful complete save resets
  the delay. Leaving makes one explicit final attempt and cancels every retry timer before disposal.
- **Exact durable revisions.** Edits arriving during an in-flight checkpoint require another save before
  `saved` can become true. A failed save says it is not saved on this device and leaves the editable
  document and file-copy action available. Closing/crashing before acknowledgement can lose unsaved work;
  no peer-sync status promises remote durability.

`recovery.test.ts` snapshots storage after every write from initialization through journal compaction,
then simulates process death without a final flush and compares reloaded CRDT proofs with each durable
revision. It includes empty-document hydration and reattachment with offline structs/deletions. A
four-update journal fixture exercises that complete cycle with bounded work; the production 128-update
limit is covered separately by the sustained-editing/compaction regression. Stalled
writes, failure retries, in-flight edits, corrupted external tails, racing replacements and retained
resource-limited records are covered separately. Production-browser tests abort IndexedDB after each
staged append write, then reload to verify transaction rollback and the previous durable document.

Privacy shutdown explicitly detaches the history driver. The retained draft starts local snapshot Undo
at the last shared canvas, including peers' preceding changes; the triggering paste/edit and later edits
are undoable locally. Privacy provenance remains outside snapshots and cannot be cleared by Undo. A
remount stays detached. Privacy flags are checked immediately, while history, binding and content-based
privacy checks reuse the same cached native diagram per immutable snapshot. Consecutive actual refusals
advance an announcement occurrence; repeated privacy polling does not.

Retention is bounded to 16 room generations and 64 MiB of ciphertext, with a 32 MiB per-record limit plus
the GCM tag. Writes atomically evict the oldest-write records (stable id breaks ties); records older than
30 days expire on read/write. The Lab explains these bounds. Browser storage eviction/clearing can still
remove a checkpoint. Generations have distinct ids, keys and AAD: no automatic cross-generation replay.
Rotation/end-session admission and explicit stale-generation recovery remain C1d work.

Room status distinguishes a completed local save from connection. “Connected and synced” requires
authenticated proofs from every currently reachable transport peer matching the local state vector **and
delete set**; reachable ids and their count are bounded. This is a current convergence observation, not a
remote durability acknowledgement, attribution or Byzantine guarantee. Any document change invalidates it.
The Lab uses only same-origin BroadcastChannel (or the injected ciphertext test wire), with page lifecycle
goodbyes, suspension/resume and bounded heartbeat expiry; no public trackers, ICE or endpoints were added.
Proofs are cached by document revision; authenticated proof/ack input has a separate 128-message/10 s
count bucket before hashing, alongside the existing byte limits. A new peer always notifies status subscribers.

**Device wipe (resolved in E2, 2026-10-18):** “Clear everything on this device” first stops an open room (its
writers, timers and connections), then empties the recovery database in one IndexedDB transaction that also
records the new storage generation. Every recovery write transaction reads that record first and aborts when it
names another generation, so a tab that hasn't heard about the wipe (a pending encryption, a slow
BroadcastChannel) can't write an old room back; IndexedDB serializes the transactions across tabs. The wipe waits
for that transaction before the page starts over (`src/lib/recoveryDb.ts`, `tests/e2e/collab-room.spec.ts`).

**Room key in tab storage (owner decision Q4, E2):** an app room keeps its link value in `sessionStorage` for that
tab only (`diagrams.collab.room.v1`), so a reload rejoins without the link. It is removed on Leave, when the tab
closes and by Clear everything; it is never written to localStorage, IndexedDB or any other tab.

Evidence: `editorRoom.test.ts`, `recovery.test.ts`, `lab/bridge.test.ts`, `collab-c1a.spec.ts`; existing
production bundle/CSP guards remain required. This slice remains Lab-only and adds no Private-diagram permission.

## Production rooms (E1–E8, 2026-10-18)

What the production feature adds to the model above.

- **Switch.** `VITE_ENABLE_COLLAB=1` builds rooms in (`COLLAB`, `src/lib/deployment.ts`), and never without share
  links. `canCollaborate = (COLLABORATION_LAB || COLLAB) && SHARE_LINKS && !isLocalOnly`. Off for self-hosted copies
  unless set. livediagrams.dev turns it on with a Vercel build variable
  ([runbook](../COLLABORATION-RUNBOOK.md)).
- **Endpoints, fixed at build time.**
  - **Defaults.** Unset, a room uses the two approved public trackers (`wss://tracker.openwebtorrent.com`,
    `wss://tracker.webtorrent.dev`) and Cloudflare STUN, with no TURN. Changing that set needs the owner's approval.
  - **Self-hosted copies** may name their own trackers, STUN and TURN (`VITE_COLLAB_*`, Q9). The values are
    validated and normalised.
  - **Where they ship.** They are defined only in the room's own lazy chunk, and kept out of `import.meta.env`, so
    they never ship at startup or in a build without rooms.
  - **Nothing in the app edits them.** That matters because CSP can't govern STUN or TURN.
  - **They don't confine peer traffic.** The transport sets only `iceServers`. A browser still runs connectivity
    checks to every candidate a peer advertises, and may connect to it directly. So a member with an outside
    address, or one who advertises one deliberately, can draw traffic out of a network. Naming TURN adds a relay but
    doesn't force relay-only (`iceTransportPolicy` stays `all`). Confining peers needs network egress controls; the
    self-hosting guide says so.
- **CSP.** In a rooms build, `connect-src` adds exactly the trackers' origins for the app, never for embeds
  (`scripts/security-headers.ts`, `src/collab/policy.test.ts`). `tests/e2e/csp.spec.ts` checks three things:
  - two browsers meet under the real headers;
  - native sockets obey that source;
  - any other tracker is refused.
- **IP disclosure.** Peers see each other's IP addresses on direct paths, and the trackers and STUN see everyone's.
  The start and join dialogs say so before anything connects, and list the hosts this build contacts. No peer
  connection exists before consent (`collab-room.spec.ts` counts them).
- **TURN credentials.** A self-hosted copy's `VITE_COLLAB_TURN_CREDENTIAL` is in the page for anyone who can open
  it, like every build value. It should be a relay-only account, and rotated by rebuilding. The Helm chart keeps it
  out of its pod annotation. A TURN server sees both endpoints' addresses, timing and byte counts, never content
  (DTLS plus our envelopes).
- **Private diagrams stay blocked.**
  - `canCollaborate` refuses a Private or local-only diagram.
  - The session refuses one too, and so does the binding for every edit.
  - A diagram that turns private leaves the room, and its draft stays on the device.
  - Share's row and Ctrl+K explain why.
- **Presence** (E5) carries selections (at most 32 ids) and a cursor in flow coordinates, sealed like document
  frames. Presence has its own rate bound, and its goodbye is sealed ahead of time. Presence never moves the view or
  the keyboard, and never appears in recordings, presentations, prints or image exports.
- **Storage.**
  - The encrypted recovery copy (IndexedDB, above) holds checkpoints only, never a key or a link.
  - The link value sits in this tab's `sessionStorage` (Q4).
  - Clear everything on this device stops an open room, then empties both.
- **No crypto review yet.** The key schedule, envelope and link format have had internal tests and reviews only. That
  is disclosed in the user docs ([EDIT-TOGETHER.md](../EDIT-TOGETHER.md)), and is one reason Private stays blocked.
- **Watch together (shared Live P2, cooperative).** A room has a third encrypted channel, `live`, for the host's run:
  - what travels: its start (the simulation, its seed-free settings and what-ifs), its ops on their ticks, beacons
    and state digests;
  - the channel's own sender subkeys and rate bound (`liveFramesPerWindow`);
  - JSON checked in full before use (every nested op, with bounded numbers, sizes and depth; parts reassembled within
    byte and time bounds), each op applied through the live controller's remote-op API (`applyRemote`), logged as
    the host's; what a follower keeps of a run is bounded too (1 MiB or 20,000 entries, 32 waiting digests), and a
    seek's synchronous work is judged by the controller from the tick it reached.

  Hosts and requests (P3) add the host's roster to its presence (co-hosts, the driver, as sender ids), and requests,
  answers, a driver's handoff and a host's handover on the live channel. All of it is cooperative too: any member
  could claim to host, ignore a "Not now" or hand themselves the run. Only Live on the room's own diagram is
  attached: a session on any other diagram, or one that becomes Private, sends
  nothing and is detached at once (every send checks). Presence carries `host`, the shown run's title and the host's
  view centre. All of it is cooperative: any member
  holds the key and could send Live frames or claim `host`. Followers trust the lowest sender id claiming it. In
  signed rooms (below) this holds against honest copies; it stays cooperative in rooms opened from v1 links. Nothing
  of a run reaches a server.

- **Monitoring.** A report-only Nightly smoke runs over the real network. It classifies failures as trackers
  unreachable, ICE/NAT or app error, and alerts after three failed nights. It never runs in PR CI.

## Signed rooms (P4, 2026-10-19)

Meeting hosts design §2, owner decisions 12 to 14: rooms started now are signed. **Not yet independently reviewed**
(decision 13): shipped disclosed as such, since it only adds checks to what rooms had; Private diagrams stay blocked
whatever the review finds.

- **The link.** `#room=v2.<epoch>.<secret>.<hostKey>`: v1's secret and key schedule (unchanged), plus the creator's
  Ed25519 public key (43 characters), the roster's root. Parsing is strict, as v1's (one canonical spelling per key).
  v1 links open as rooms without roles for one more release (decision 12).
- **Identities.** Each tab has an Ed25519 key pair (WebCrypto, `src/collab/signing.ts`), its private half kept as a
  JWK in the tab's `sessionStorage` record beside the room value (the same class of secret), never sent. The
  creator's is the root. A reload keeps it; a duplicated tab (the `BroadcastChannel` check) makes a new one.
- **Bindings.** Presence carries the member's key, its Yjs client id and the key's signature over both with the
  session's sender id, the room id and the epoch. The first key a sender binds is the one it keeps (a later claim is
  refused); its client id can change under a new binding by the same key.
- **Signed frames.** Every frame's message carries its sender's signature over a label, the room id, the 32-byte
  header (channel, epoch, sender, counter) and the message, inside the AES-GCM envelope. In a signed room the
  opener records a frame's counter only after the signature verifies under the sender's bound key, so a frame
  forged under another sender id (anyone with the link can seal one) can't use up that sender's counters.
- **The roster** (`src/collab/roster.ts`) is a causal set of signed entries (admit, co-host, un-co-host, drive,
  host, policy), each over a label, the room id, the key epoch, its fields and its `deps`: the entries its signer
  had seen (its roster's heads, at most 32). Its Lamport counter must be exactly one more than its deps' (else
  refused), and it's kept only once all of its past is here (up to 256 entries wait for theirs).
  - **Causal authority.** An entry counts if and only if its signer had the authority in its own causal past: the
    host for a handover, the host or a co-host for everything else. That past is fixed when the entry is made, so
    whether an entry counts never changes: a concurrent "Not a co-host" or "view only" can't revoke an admission
    that was valid (review P1), and every peer agrees on which entries count whatever order they arrive in.
  - **Permanent admissions.** Who can edit is the host plus everyone a counting admit, co-host or host entry names:
    it only grows (design rule 3). The rest (host, co-hosts, driver, the switch) is a projection: the counting
    entries folded by (counter, signer key, signature), each applied only if its signer still had the authority at
    its place in the fold (this resolves P3's partition-ordering item).
  - **No backdating past the switch.** Only the host and co-hosts admit; a plain editor's admission never counts.
    So an editor can't get round "view only" by signing an admission whose deps claim it came first (review P1):
    admitting always takes host or co-host authority. The switch only decides whether leads' pages admit newcomers
    on their own.
  - **Epochs.** Every entry is bound to the key epoch: a new epoch (P5's Remove with re-key) starts its roster from
    the host's state, and nothing of the old one carries over. That is the only way to cut off a former co-host who
    signs entries claiming to predate the "Not a co-host" (indistinguishable from a concurrent honest entry).
  - **Slots and forks.** Each signer has one slot per sequence number (one more than its entries in the entry's
    past), at most 256. An honest signer's entries form a chain, one per slot. Two entries by one signer in one slot
    (siblings on the same past: a fork, which only a misbehaving signer makes) can't both count: the first in the
    roster's order holds the slot wherever it's placed (one that sorts before a slot's holder makes the roster be
    placed again from scratch, in order), and the other is kept only as a known entry that changes nothing (16 per
    signer, 256 in all; past that, a signer's further forks are refused). So what one key stores is bounded whatever
    it signs, and peers holding the same entries agree (review round 2: a revoked co-host's flood of siblings takes
    one slot).
  - **Bounds.** 1,024 counting entries, of which entries by anyone but the host (in the entry's past) take at most
    768: the host can always act. One entry per signature (canonical base64url only: an alias is refused). Past the
    768 (reachable only with many co-hosts each signing hundreds of entries), which non-host entries got in can
    differ between peers: the one overflow that isn't deterministic.
  - **Ingestion.** Entries are taken in order, each placed as soon as its past is here, so a whole roster (a
    newcomer's, a reload's) places in one go however long; only entries genuinely missing their past wait (256), and
    an entry already known is never verified again (review round 2).
  - **Replication.** `DOC.roster`: in full to each peer that appears (a past before what follows it), each new entry
    to everyone, and a summary each anti-entropy round that a peer whose roster differs answers with its entries
    (four times a window at most). It's kept in the tab's record and checked again as a reload opens.
- **Authorisation, by bytes and the roster only** (design rule 1): a direct update counts from an editor whose
  update's structs all carry its own bound client id; a sync reply only from an editor; viewers never serve sync.
  Roles only add editors (rule 3), so no honest peer refuses what another honest peer applied.
- **Held, not rolled back** (rule 2). A document frame that doesn't count yet (its sender's binding or grant still
  on the way) is held per sender (4 MiB, 30 s), never applied; once it counts it's applied, updates and sync replies
  in order, or past the bounds it's dropped with its sender quarantined. Per sender, frames waiting for its binding
  are kept apart from its verified updates that don't count yet. Roster and sync messages never wait behind a held
  update (one may carry the very grant it waits for, review P1): a frame arriving behind blocked updates is opened
  and, if it's one of those, handled at once, without rescanning them. The blocked updates are checked again only
  when the roster or a binding changes, from the first, each update's clients decoded once (review round 2). A
  newcomer in a room where new people may edit is admitted by the host if here, else the earliest co-host here;
  with neither, they view until one is back (a page only edits once the roster says it may, so an honest
  newcomer's edits never need holding).
- **Bindings by frame order.** A binding counts from its presence frame's counter: an older frame never replaces a
  newer binding. A deferred frame's sender subkey is cached only once its frame is accepted (review P1).
- **Live.** A shared run's messages count only from its driver (the roster's while here, else the host), or, for the
  run it drove, from the last driver for 30 s after the roster moved on, until its handoff. A handoff counts only to
  the driver the roster names: one that arrives before its grant waits for it (30 s); one to anyone else grants
  nothing, and nothing renews the last driver's moment (review P1). A follower whose driver was superseded twice
  before its handoff came (neither the roster's driver nor the last one) follows the roster's driver, asking it for
  its run (review round 2). A yes to a request, a handover and who drives
  are roster entries; the P3 `host` message and a yes in an `answer` change nothing.
- **Bounds.** Signature verifications per sender per window (`verifiesPerWindow`, 2,048: frames and roster
  entries), checked after the cheaper per-channel bounds; a binding is verified once; a roster entry once.

What it holds, against peers running an honest copy: a viewer's edits reach nobody; only the driver moves the shared
run; only the host and co-hosts change roles, and only the host hands the room on; nobody sends edits, Live commands
or roster entries as another member. What a modified client can still do: edit its own copy and show anything
locally, and keep or forward what it receives; vandalise if it can edit (editors are trusted to edit); claim another
editor's client id in a struct through a sync reply (attribution between editors stays best-effort); flood within the
bounds; bind a newcomer's sender id first if it sees it before the newcomer's first presence (that newcomer's frames
are then refused: a denial of service, not an impersonation); fill the roster with entries that change nothing,
within the bounds, if it's a host or co-host; as a former co-host, sign entries whose deps claim they predate the
"Not a co-host" (they count, as a concurrent honest one would, until a new epoch). Making an editor a viewer again,
and removing anyone, need a new epoch (P5).

**What this adds to the crypto review's scope** (design §2): the v2 link; the identity key in `sessionStorage`; the
roster's causal authority (deps and their Lamport counters, authority evaluated in each entry's own past, permanent
admissions, the projection's fold and its tie-break, admission limited to leads, what a former co-host can still
sign until a new epoch) and its storage bounds; canonical signature encoding; binding session
keys to the sender id and Yjs client id (and re-binding the client id); signing inside the AEAD (what the signature
covers, verification before the replay window records a counter); the holding buffer and its quarantine; replay of
signed Live commands across runs (bounded by the run id and the driver check) and epochs (the epoch is signed); and
the algorithm (Ed25519 in WebCrypto) against ECDSA P-256 (decision 14). Still to come with P5: the lobby and content
key split, the per-recipient key wrap, epoch transitions with offline members, and the knock path.

Tests: `src/collab/signing.test.ts`, `roster.test.ts` (forged, re-roomed and re-epoched entries refused; signature
aliases refused; a counter that isn't its past's refused; an editor's and a backdated admission refused; admissions
concurrent with "Not a co-host" and with "view only" kept; an entry waits for its past; order independence after a
partition; bounds), `signedSession.test.ts` (a viewer's and a modified copy's edits ignored by everyone; an edit that
raced its grant held then applied; viewers don't serve sync; no admission without a lead here; a forged frame refused
without using up the sender's counters; a forged roster entry refused; convergence; a lost grant recovered by
anti-entropy; only the held sender supplying its own grant; a held update read once; bindings by frame order; the
verification bound), `envelope.test.ts` (no subkey kept for a deferred frame not accepted),
`room/signedWatch.test.ts` (only the driver's run messages count; an early handoff waits for its grant; a handoff
to someone no grant names grants nothing; alternating handoffs never renew; roster changes overtaking handoffs; a yes
or a handover in a message changes nothing), the roster's import of a log longer than the waiting bound (import,
reload, replay) and a revoked co-host's sibling flood, and a held update decoded once across authorisation changes
and `room/lifecycle.test.ts` (a reload keeps verified roles; a changed record entry doesn't count; a v1 link opens
without roles; a duplicated tab signs as someone new).

## Residual risks and open items for C1

1. **Independent review** of the key schedule, envelope and link format before any Private-diagram promise.
2. **Roles and attribution:** one shared key means any member can write and impersonate another session. Signed
   rooms (P4, above) address it against honest copies; v1 rooms stay cooperative for one more release.
3. **Removal and rotation:** the epoch field and per-epoch keys are in place; the transition (new generation from
   the visible state, fresh links, refusing old-epoch writes) is not built. End session is not built.
4. **IP exposure:** peers see each other's IPs on direct paths, trackers see everyone's. Disclosed before joining
   and starting (E4). A TURN-only mode needs a TURN service with safe credentials (an owner decision). Self-hosted
   copies can configure TURN at build time (E7), and its credential is public to their users.
5. **Public infrastructure terms and availability:** check each tracker's terms, contact operators, credit them,
   and respect announce intervals. Their hosts are in `connect-src` only for builds with rooms (E7), and the Nightly
   smoke watches their availability (E6).
6. **Local recovery:** C1a implements encrypted per-generation IndexedDB and distinct local-save/sync states
   as described above. Production share/join recovery and consent remain C1b; no remote durable storage exists.
7. **Editor binding:** C1a wires the real history commit, scoped Undo and session-unique create/paste ids.
   Labels remain last-writer-wins fields; simulation playback remains local. Production room mounting waits
   for the remaining C1 acceptance gates.
8. **Labels as collaborative text** (Y.Text) and movable list order remain C1 or later decisions; C0 uses
   last-writer-wins fields and arrays with deterministic de-duplication.

## C0 measurements

Operation counts, bytes and same-run growth ratios (`src/collab/scale.test.ts`; `COLLAB_SCALE_LOG=1` and
`GROWTH_LOG=1` print them), never milliseconds. Sizes are 625 and 5,000 nodes from the benchmark generators.

- A full 5,000-node room's state is 2.07 MB (service mesh, 8,281 edges) or 1.90 MB (boundaries and annotations):
  one document message, sent as two or three 1 MiB fragments.
- One edit is one command, a 25 to 26-byte update at either size, and one record re-read on the receiver.
- A committed move adds about 11 bytes to the document.
- Growth from 625 to 5,000 nodes (linear is about 8, the limit 24): hydrate 8.7 to 11, diff and apply 9.5 to 9.9,
  joining sync 7.4 to 11.7, projection 7.6 to 9.1, deleting every node 7.2 (it was 50.6 before deleting order
  entries as runs, which the test now guards).
- Churn: each short-lived editor adds about 3 bytes to the state vector and 14 bytes to the document.
- Lazy bytes: the Lab's collaboration chunk (Yjs, lib0, `src/collab/` and the Lab panels) is 133.1 kB raw,
  41.4 kB gzip, loaded only when the preset opens. Production builds contain none of it; the entry chunk stays
  105.7 kB gzip against its 123.5 kB budget.
