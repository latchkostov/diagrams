# C1a review round 1 (2026-10-16)

All 14 findings in the 20261016-152948 report are fixed. The three rejection findings
share one typed API and one accessible recovery surface; none is dismissed as inapplicable.

| Finding                               | Resolution and regression                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: concurrent split IDs              | Both new-node insertion and existing-node insertion pass the room allocator to `splitFlowEdge`. Concurrent splits on different edges retain all five connections.                                                                                                                                                                                                                                                                  |
| P1: drop settlement Undo              | A gesture capture stays open through the deferred drop/resize settlement render. One Undo restores position, membership and boundary dimensions; the membership toast uses the same step.                                                                                                                                                                                                                                          |
| P1: remote projection cost            | Immutable nested settings bypass comparisons by identity; positions compare coordinates directly. Unchanged Flow records survive projection, and room history caches their persisted record keys. A 5,000-node regression counts serialization and settings visits.                                                                                                                                                                |
| P1: recovery checkpoint cost          | Encrypt and append bounded CRDT deltas in a separate IndexedDB journal. Compact after 128 entries or before 256 KiB of journal ciphertext. A metadata cursor lets another tab merge just the journal tail; checkpoint replacement changes its identity. CAS, expiry, eviction and durable acknowledgements remain atomic. Tests count encodes, full reads and encrypted bytes, including alternating writers on a 5,000-node room. |
| P1: effective privacy                 | The room port supplies the current candidate diagram and live canvas privacy flags before any room command. A privacy-only change is checked too. Restricted edits leave the session before publishing or recovery; a Private paste stays in the canvas and its downloadable copy carries `private: true`. The content-detector regression uses a synthetic mocked match.                                                          |
| P2: removed inspector control focus   | Every remote projection originating in this editor checks whether its focused control disconnected. Focus returns to the canvas only if it fell to the body; surviving controls keep focus. Pending recovery frames are replaced by the newest projection. Inspector target identity preserves the correct removal announcement.                                                                                                   |
| P2: accessible rejection feedback     | A localized, reason-specific alert explains the undone edit and the next action. The Lab exposes Save a file copy for refusals and Private drafts, and clears the alert after a valid edit.                                                                                                                                                                                                                                        |
| P2: capture identities across remount | Capture IDs come from the session allocator. Edit/detach/remount/edit/Undo leaves the first editor's independent change intact.                                                                                                                                                                                                                                                                                                    |
| P2: architectural commit-result API   | `EditorRoom.commit` returns applied, unchanged or refused with a typed reason; the adapter forwards the binding result and notifies its UI.                                                                                                                                                                                                                                                                                        |
| P2: backward clock correction         | Future checkpoint timestamps have age zero; only actual expiry or verified corruption removes a checkpoint. Encrypted work survives a one-millisecond rollback.                                                                                                                                                                                                                                                                    |
| P2: existing autosave preservation    | Seed an unrelated valid autosave, edit/reload/rejoin the room, compare its exact key/value, then open the local diagram and verify its content.                                                                                                                                                                                                                                                                                    |
| P2: concurrent paste references       | Both peers paste a connected graph, boundary and annotation. Counts, edge endpoints, membership and separation from originals/other copies are asserted.                                                                                                                                                                                                                                                                           |
| P2: typed refusal API                 | The same discriminated commit result exposes every refusal instead of discarding it. API regressions cover all three outcomes; the production browser checks alert semantics and recovery.                                                                                                                                                                                                                                         |
| P2: mismatched peer proof             | An authenticated differing proof removes that peer's synced status and notifies subscribers. The regression drops an update, then delivers the peer's valid deletion-aware proof alone.                                                                                                                                                                                                                                            |

## Measurements

Windows, Node 24.22.0, the repository's `serviceMesh(5000)` (5,000 nodes, 8,281 edges).
Each comparison warmed once and took the median of nine runs on the same machine.
The baseline is the implementation at the branch's pre-fix HEAD, restored only for the measurements.

| Operation                                        |          Before |    After |
| ------------------------------------------------ | --------------: | -------: |
| Retain selection after one remote rename         |       85.677 ms | 4.788 ms |
| Derive the room's history key                    |        4.116 ms | 3.018 ms |
| Apply a rename and await encrypted recovery save |       74.754 ms | 0.186 ms |
| Plaintext encrypted for each recovery save       | 2,396,961 bytes | 42 bytes |

Projection retention excludes conversion and React rendering. Recovery uses real AES-GCM with an
in-memory store, excluding browser IndexedDB disk latency. These measurements describe this run;
the regressions assert operation counts and relative byte sizes, never millisecond budgets.
Ordinary local snapshot history retains its existing representation.

## Deliberate regressions

Each mutation is run against the corresponding regression, then restored before normal verification:

- Restore local split-edge allocation: both concurrent insertion paths fail.
- Reuse capture tags across controllers: remount/Undo fails.
- Restore deep serialization of all remote elements: the 5,000-node operation-count test fails.
- Force full checkpoints for every edit: bounded encrypted-journal assertions fail.
- Stop reading external journal tails: alternating-tab full-read assertions fail.
- Ignore the port's candidate privacy: the synthetic effective-content privacy regression fails.
- Discard the binding's refusal result: the typed API regression fails.
- Restore future-timestamp rejection: encrypted clock-rollback recovery fails.
- Ignore differing authenticated proofs: the stale-sync regression fails.
- Stop remapping pasted connection references: the connected concurrent-paste regression fails.
- Remove gesture capture from room commits: both drop/growth and resize/adoption browser tests fail.
- Restore element-removal-only focus recovery: the surviving-node/vanished-control browser test fails.
- Downgrade the rejection alert to an ordinary status: the browser's accessible-alert assertion fails.
- Delete the seeded autosave during room saving: the preservation browser test fails.

The legacy-database migration fixture now migrates an actual checkpoint before making new journal
edits. It reopens through the recovery link, since the invitation key is deliberately consumed from
the URL fragment. No secret is persisted to make an unkeyed reload reopen a room.

## Decisions and output parity

Keep the Lab scope and existing chrome budget. No new simulation, planning or stencil feature is
introduced, so this fix batch needs no showcase. Keep full checkpoint validation for initialization,
compaction and restored state; do not weaken guards or overwrite unrelated device autosaves.
Save/rollback feedback belongs in the Lab's existing status region, outside the canvas.

The only intentional golden change is `node/i18n/catalogs.json`: nine English `collab.*` messages
cover refusal reasons, vanished controls and honest Private-draft status. Catalog counts, English
fallback counts and the collaboration-area fingerprints change; every other area and every diagram,
simulation, layout, import/export and browser golden must stay unchanged.

## Review round 2 (20261016-170532)

All 15 findings (6 P1 and 9 P2, including overlapping reports) are addressed; none is dismissed.
The complete recovery invariants are in the collaboration threat model rather than only per-finding patches.

| Concern                              | Resolution and regression                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing initial/offline base         | First attachment requires a full checkpoint, even over existing storage. Crash snapshots after every durable write compare complete CRDT proofs through initialization, offline reattachment, ordered appends and compaction.                                                                                                                           |
| Unbounded failed-storage backlog     | At most 256 KiB/128 pending deltas. Overflow/failure discards redundant deltas and requires a full checkpoint retry. Stalled-write and 1,000-edit regressions assert the byte bound and exact recovery after retry. Edits during checkpoint encryption/write cannot be prematurely acknowledged.                                                        |
| Closed-room Undo                     | Explicit detachment changes the controller to local snapshot history at the last shared baseline. Unit and production-browser tests undo the private paste/triggering edit and a subsequent edit, retain peer changes and sticky privacy, and cover a privacy-only transition and remount. Deferred remote projections retain their resulting baseline. |
| Consecutive identical refusals       | Actual refusals advance a subscription/alert occurrence. Unit tests observe both attempts; the browser asserts a new alert DOM node, the same explanation and retained focus. Repeated privacy checks are deduplicated.                                                                                                                                 |
| Corruption in external/full journals | Shared authentication/schema validation; conditionally remove only corrupt tokens, recover the valid checkpoint plus live edits, and replace storage. Ciphertext, IV and schema faults cover external tails; tests retain resource-limited records and protect a racing valid replacement. Full-restore fallback has its own proof regression.          |
| Repeated diagram conversions         | History, privacy and binding reuse `snapshotDiagram`. The operation-count test requires one conversion per changed snapshot across all checks, zero for repeated checks, and immediate flag-only privacy closure.                                                                                                                                       |
| Init-script ordering                 | `relay` takes the initial diagram and installs it alongside the room and wire in its single context script. Both boundary gesture regressions retain their behavior assertions.                                                                                                                                                                         |
| Cached membership after removal      | Warm the member cache, remove only its boundary, retain the member object and compare the result with a fresh diagram whose node has no membership.                                                                                                                                                                                                     |

Rejected approaches: merging historical updates indefinitely (unbounded bytes and synchronous work),
appending an empty diff after attachment (missing CRDT structs/clocks), leaving Undo on the closed driver
(dead editing controls), treating resource limits as corruption (destroys recoverable work), and replacing
output goldens to hide a failure. Only the intentional i18n catalog addition changes output parity.

Deliberate reversion evidence: fourteen unit mutations fail their targeted behavior assertions: attachment
base, pending-byte bound, external-tail corruption handling, checkpoint fallback, local-history event,
repeat-refusal occurrence, conversion reuse, membership invalidation, in-flight checkpoint coverage,
post-shutdown remount, pre-edit history baseline, resource-limit retention, malformed external-tail byte
checks, and stable history keys across detachment. Browser mutations cover repeated alert replacement and
the single-script boundary fixture and damaged-copy guidance. All mutations are restored before normal checks and the full gate. Browser transaction-abort tests additionally verify
both staged append writes roll back to the last durable state.

The first full gate caught one stale generated headless skill helper after the i18n catalog shifted its
compiled message IDs (8,587 other unit tests passed; four skipped). `pnpm schemas` refreshes the four ID
references in `scripts/lib/app.mjs`; all 175 skill checks then pass. Temporarily restoring the old helper
fails its existing generated-file regression again. Build, entry size and all 2,196 parity goldens passed
in that stopped run; the final committed tree receives a fresh complete gate before pushing.

A second full unit run hit the default hang backstop in the crash fixture under worker-pool load. The
fixture now uses a four-update journal and checks every durable write through compaction, avoiding
thousands of redundant decryptions; the separate sustained-editing test still covers the production
128-entry limit. Its six-write cycle and compaction assertions fail deterministically if the bounded
fixture is reverted to the production journal depth. No timeout or timing assertion is raised.

The shared decoder allows a checkpoint plus its 128 deltas; external tails separately enforce the
128-delta cap. A 129-entry authenticated external tail must remain stored as a resource-limit refusal,
then save successfully after repair. Removing that exact tail-count guard fails the retention regression.

A subsequent full run exposed the same hang-backstop risk in the existing twelve-seed convergence
sweep. It is now twelve independent cases, retaining all twelve seeds, all sixteen steps per seed and
every convergence/history assertion, with cleanup per seed rather than after the whole sweep.
