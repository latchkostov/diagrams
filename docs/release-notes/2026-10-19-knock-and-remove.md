## Edit together: knock-to-join and Remove with re-key (P5)

The meeting hosts design's fifth slice (§2; owner decision 11: knock on for new rooms, co-hosts admit too). Shipped
before the independent crypto review, disclosed as not yet reviewed; Private diagrams stay out of rooms.

- **A v3 room link**, `#room=v3.<secret>.<hostKey>`, opens only the room's lobby: its name, finding the others, and
  knocking. The room's content is under a secret per epoch that the link doesn't carry. v2 links (P4) and v1 links
  open as before.
- **Knock-to-join.** A newcomer's page knocks and waits ("Asking to join… The host or a co-host will let you in."),
  with nothing of the room: content goes only to peers who've proved they hold the epoch's secret, and only members'
  presence and requests count. The host and co-hosts get a card under the chip (never taking focus): **Admit** or
  **Deny**. Admit signs a `join` entry (and lets them edit unless "New people can view only" is on) and hands them the
  room's epochs and the current secret, wrapped for their own key-agreement key (X25519). Deny tells them (signed, and
  checked against the roster), and they leave with nothing. The connecting states (no servers, nobody answering,
  Retry) work while knocking too. This closes P4's binding-race backlog item.
- **Ask before people join** (a host's or co-host's switch, on for new rooms). Off, the host's page (else the
  earliest co-host's here) lets people in on its own; with neither here, people knock until one is back.
- **Remove from room** (host or co-host; never the host): a signed removal, then a new epoch: a fresh secret, its
  start signed by the remover and committing to it, wrapped for every member left (absent ones too), and every page
  re-keyed in place: the same document, the same Live run, the same sender. Frames from any other epoch are refused,
  so the removed person's old key opens nothing new, and their page leaves with a notice; their copy stays theirs.
  Removed while driving: the host drives. The new epoch's roster starts from the last one's state without them, and
  no entry from before counts in it, which ends P4's residual (a former co-host's backdated entries).
- **Edge cases.** Two removals on two sides of a partition resolve to one chain everywhere (its first removal; the
  other removal is made again); someone let in just as someone else is removed knocks again and is let back in on
  its own; a member away during a re-key (or reloading after one) is handed the new secret when they're back, and a
  removed one coming back is told; a reload keeps the current epoch (its secret in the tab's record).
- **Hardened in review** (one P0, nine P1s):
  - Epochs only move forward. A session moves only to a later epoch that brings back nobody its own path removed,
    and never seals twice under one key. So a removed co-host's earlier removal in a closed epoch, or an epoch of its
    own, changes nothing, and no (key, nonce) pair repeats.
  - A start counts only with its authority (the host for epoch 0, the remover for later ones), checked before it's
    kept. Unplaceable starts wait in a small pool, resolved with bounded work.
  - Lobby frames are signed over their header, so the replay window moves only once a frame verifies.
  - Wraps are signed and checked before they're kept.
  - Knocks are bounded per peer and in all, and expire.
  - An unusable agreement key is refused before anything is signed, and Remove prepares everything before it changes
    anything.
  - No recovery record while knocking.
  - Presence ordering restarts on a re-key.
  - A removal made at the same moment as another is carried out once, by the winning side.
  - Waiting to be let in no longer reads as "nobody answered", and admit cards keep focus and fit the viewport.
- **The join hotfix (#201), on the knock path too.**
  - Frames that can't be checked yet are never held against their sender, and they're asked for again once they can
    count.
  - Bindings go first.
  - The adverse-delivery tests run for knock-to-join rooms as well: let in late, let in just before a re-key, the
    host's lobby hellos or presence lost, a large document, and frames reordered, lost and duplicated. Every case now
    asserts the joiner's document converges with the host's.
  - #201's follow-ups:
    - a healthy join asks for the document once;
    - someone whose replies were dropped before their grant arrived is asked again once it does;
    - the wait's reasons include `admission` (at the door, asked);
    - one diagnostics snapshot (`session.diagnostics()`, on the wait and the chip as `data-diagnostics`) replaces
      `data-rejected`;
    - a browser without X25519 is told plainly too.
- **Docs.** [EDIT-TOGETHER.md](../EDIT-TOGETHER.md) has **Join a room** (knocking), **Letting people in** and
  **Remove someone**, and the signed-roles and privacy sections updated; the
  [threat model](../research/collaboration-threat-model.md) has the P5 design, what it holds and what a modified
  client can still do, and what it adds to the crypto review's scope.

Bundles: all new code is in the room's lazy chunk; startup, canvas first view and the Live session don't grow. i18n:
nine new strings (`collab.knockingTitle`, `collab.knockingHint`, `collab.knockPrompt`, `collab.admit`, `collab.deny`,
`collab.removePerson`, `collab.askBeforeJoin`, `collab.deniedNotice`, `collab.removedNotice`) and two changed
(`share.editTogetherDesc`, `collab.startLead`: the link lets people knock, not join), so the catalogs golden is
re-recorded.
