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
- **Remove from room** (the host's alone; never of the host): a signed removal, then a new epoch: a fresh secret,
  its start signed by the host and committing to it, wrapped for every member left (absent ones too), and every page
  re-keyed in place: the same document, the same Live run, the same sender. Frames from any other epoch are refused,
  so the removed person's old key opens nothing new, and their page leaves with a notice; their copy stays theirs.
  Removed while driving: the host drives. The new epoch's roster starts from the last one's state without them, and
  no entry from before counts in it, which ends P4's residual (a former co-host's backdated entries).
- **Edge cases.** As only the host removes, the room's epochs are a single line: a dropped connection never splits
  the room across keys; someone let in just as someone else is removed knocks again and is let back in on
  its own, if whoever let them in still hosts or co-hosts; a member away during a re-key (or reloading after one) is handed the new secret when they're back, and a
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
- **Hardened in a second review** (one P0, nine P1s that came down to six issues):
  - Closed epochs are frozen at their close for what they grant now: being let back in on one's own, or a concurrent
    removal carried out, needs its signer to host or co-host in the current epoch. A removed co-host's backdated join
    in an epoch it once led lets nobody in; the newcomer knocks and waits for an answer.
  - A chain goes in epoch by epoch (each start, then its roster, before the next), so a room past 16 removals still
    reloads and lets people in, through every supported epoch.
  - The local copy is keyed by the epoch's scope, so two tabs on two sides of a partition don't delete each other's.
  - Someone removed and let back in no longer stops the next removal reaching everyone.
  - The lobby is bounded per transport peer before anything is decrypted or verified: a budget per peer, two sender
    ids per peer, a pool of its own for people at the door, places freed when a peer goes, and bounded buckets.
  - A browser without X25519 (or Ed25519) can't start a room, and says so, instead of quietly making one anyone with
    the link walks into.
  - A duplicated tab starts at the door with keys of its own, none of the original's secrets.
  - Answering the last card from the keyboard puts focus on the room chip; Admit and Deny name whom they're for.
  - A healthy join sends one sync request: none again on joining for a peer already asked, nor while a request to
    that peer is still to be answered.
  - After a re-key the chip counts the others as soon as they've proved they're in (it waited for something else to
    change, so it could read "waiting" with someone there).
- **Simplified after a fourth review** (four P1s, owner decision: Remove is host-only):
  - Only the host removes (co-hosts still let people in, deny, and change roles; handing the room over hands Remove
    over). An epoch's start counts only as the host's, one per epoch, so the epochs are a single line, and the
    machinery for concurrent removals (sibling epochs, carrying out the other side's removal) is gone. A co-host's
    removal, current, former or removed, never counts, whenever it arrives; a start, once placed, stays placed
    whatever forks arrive later, so a record reloads the same. "Remove from room" is in the host's menu only.
  - Roles resolve by who each person is across a re-key, so the driver stays the driver while the room moves to a
    new key.
  - The lobby puts fragments back together under small limits of its own, and people at the door make way for
    members, so two sender ids can't block an admission.
  - Answering the last card while presenting leaves focus on the canvas; a co-host who stops being one loses their
    cards; "Ask before people join" in an open menu follows the room's setting; a bundle with nothing new tells
    nobody; a stored record's chain and wraps are checked in full.
- **A fifth review** (three P1s):
  - Remove is one transaction: the removal, the next epoch's start, its wraps and every message carrying them are
    made before anything is kept or sent. At the room's last epoch Remove changes nothing and the host is told: "This
    room has reached its removal limit. Start a new room to remove anyone else."
  - A long chain (every epoch, full rosters: over a lobby message's 4 MiB) travels in pieces, so members, members
    catching up and newcomers all get it.
  - Smaller: waiting to be let in ends when everyone who answered leaves (the no-answer wait and Retry come back);
    knock cards keep their order; half-delivered lobby messages expire on the room clock; tests for Ask before people
    join off (the host, a co-host, neither).
- **A sixth review** (one bug, four P1s): the host's roster writes (an entry, an admission, a whole removal with its
  re-key) are one queue, so a removal overlapping Make host, a policy change or an admission never drops either; a
  removal that can't be made says so ("{alias} wasn't removed: the room changed meanwhile."). A long chain's pieces
  each fit one frame and are taken in any order; a no waits for its chain, and someone told no who knocks again is
  told again.
- **A seventh review** (five issues): a no counts only from who hosts or co-hosts now (never from an epoch the
  denier once led), and its chain is taken once; nothing irreversible is decided on part of a chain; leaving lets a
  Remove under way re-key, and the handover land in the new epoch, before the goodbye; an Admit waiting its turn
  takes the card at once, so a Deny can't overtake it.
- **An eighth review** (two causes): a page catching up keeps every chain a peer has promised (per sender, only
  ever raised) until it has it, and decides nothing irreversible meanwhile: not leaving, not knocking again, not
  taking a no; a promise nobody keeps lapses after 20 s without progress. Leaving sends the chain to the lobby only
  after a re-key.
- **A ninth review** (two causes): decisions that read the chain wait, in the inbox, for whatever's being received
  to be validated; leaving sends the chain to the lobby whenever an entry since the last re-key may not have reached
  a member; one catch-up deadline since the chain last grew, which nobody can renew by promising more.
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
fourteen new strings (`collab.knockingTitle`, `collab.knockingHint`, `collab.knockPrompt`, `collab.admit`,
`collab.deny`, `collab.admitNamed`, `collab.denyNamed`, `collab.removePerson`, `collab.removalLimit`, `collab.removeFailed`, `collab.askBeforeJoin`,
`collab.deniedNotice`, `collab.removedNotice`, `collab.unsupportedStart`) and two changed
(`share.editTogetherDesc`, `collab.startLead`: the link lets people knock, not join), so the catalogs golden is
re-recorded.
