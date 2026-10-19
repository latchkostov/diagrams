## Edit together: signed roles (shared Live P4)

The meeting hosts design's fourth slice (§2): roles that hold. Rooms started now are **signed rooms**; who hosts,
the co-hosts, who drives Live, who can edit and the room's "view only" switch are signed by whoever changed them,
and every page checks them. Shipped before the independent crypto review, disclosed as not yet reviewed (owner
decision 13: it only adds protection); Private diagrams stay out of rooms. Ed25519 in WebCrypto (decision 14, the
final choice the review's).

- **A v2 room link**, `#room=v2.<epoch>.<secret>.<hostKey>`: v1's secret and key schedule, plus the creator's
  public key, the root every role traces back to. v1 links keep opening, as rooms without roles, for one more
  release (decision 12). A browser that can't sign starts v1 rooms.
- **Identities.** Each tab signs with a key pair of its own, kept beside the room link in the tab's record (never
  sent); the creator's is the root. Presence binds it to the session's sender id and Yjs client id, signed.
- **Signed frames.** Every document, presence and Live frame carries its sender's signature inside the encryption,
  checked against the key its sender bound before anything uses it. A frame forged under someone's sender id is
  refused without using up their counters (the replay window records a counter only once the signature verifies,
  and its sender's subkey is cached only then).
- **A signed roster with causal authority** replaces P3's presence-carried roster: admit, co-host, not a co-host,
  drive, host and policy entries. Each names the entries its signer had seen (`deps`), its Lamport counter exactly
  one more than theirs, and counts if and only if its signer had the authority in that causal past, so whether it
  counts never changes. Admissions are permanent: a concurrent "Not a co-host" or "view only" can't undo one that
  counted. Only the host and co-hosts admit, so nobody can backdate an admission past "view only". The other roles
  are folded from the counting entries in one order everywhere, so P3's two-rosters-after-a-partition follow-up is
  resolved. One signature has one (canonical) spelling. It's sent in full to each peer that appears, each new entry
  to everyone, and summarised every anti-entropy round (a peer whose roster differs sends its entries). Kept with
  `RoomRoster` in the tab's record, so a reload keeps verified roles, checked again as it opens.
- **Edits only from editors.** A direct update counts only from an editor, with structs of its own bound client id;
  a sync reply only from an editor; viewers never serve sync. What doesn't count yet (a grant or a binding on its
  way) is held per sender (4 MiB, 30 s), never applied and never rolled back, then applied in order once it counts,
  or dropped with its sender quarantined. Roster and sync messages never wait behind a held update (one may carry
  its grant), and a held update is checked again only when the roster or a binding changes. Roles only add editors,
  so honest peers can't diverge.
- **Who can edit.** New people edit by default; the host's or a co-host's **New people can view only** (chip menu)
  makes joiners viewers. A viewer's change is undone at once with a note ("you can view this room, not edit it"), and
  never sent. **Can edit** in the people menu lets them edit. While new people may edit, the host's page (else the
  earliest co-host's here) admits each newcomer a moment after they join; with neither here, newcomers view until
  one is back. A change in this person's editing is announced, and the chip's label says "can view".
- **Live, by the driver only.** A shared run's messages count only from the roster's driver (while here, else the
  host), and, for the run it drove, from the last driver for 30 s after the roster moved on, until its handoff. A
  handoff counts only to the driver the roster names (one that arrives before its grant waits for it), so a handoff
  never grants the run and nothing renews the last driver's moment. A yes to a request, Make host and Leave room's
  handover are signed entries; P3's `host` message and a yes in an answer change nothing in a signed room.
- **A co-host-capable people menu** (P3 follow-up): co-hosts get the people menu (co-host, drive, **Can edit**; no
  co-host row for the host); Make host stays the host's.
- **Bounded verification.** Signature checks per sender are bounded (`verifiesPerWindow`, 2,048 per 10 s: frames and
  roster entries), after the cheaper per-channel bounds; each binding and roster entry is verified once. The roster
  holds 1,024 entries, 256 per signer, keeps only entries that count, and 256 waiting for their past. An older
  presence frame never replaces a newer binding.
- **Docs.** [EDIT-TOGETHER.md](../EDIT-TOGETHER.md) has **Who can edit** and **Signed roles** (what it holds, what a
  modified page can still do, the review); the [threat model](../research/collaboration-threat-model.md) has the
  design, the residual risks and what P4 adds to the crypto review's scope.
- **Not in this slice:** the typed controller guard (the Live controller is mid-change for Requests that wait) and
  making an editor a viewer again (a new epoch: P5).

Bundles: all new code is in the room's lazy chunk; startup, canvas first view and the Live session don't grow
(startup 176,457 B against master's 176,459 B gzip; Live session +3 B, chunk-name hash churn). i18n: six new
strings (`collab.roleViewing`, `collab.letEdit`, `collab.newViewOnly`, `collab.youViewOnly`,
`collab.nowEditing`, `collab.refusedViewOnly`), so the catalogs golden is re-recorded.
