## Knock-to-join and Remove with re-key (P5) follow-ups

P5 closes two of the signed-roles follow-ups (`2026-10-19-signed-roles-followups.md`): the binding race (nothing is
sent to someone at the door) and "making an editor a viewer again" (remove, then let them back in as a viewer). A
former co-host's backdated entries now end at the next removal.

- **The crypto review** has P5's additions to its scope (threat model). Until it reports, P5 is disclosed as
  unreviewed, and Private stays blocked.
- **Retire v2 links** with v1's (owner decision 12): a v2 room is a signed room anyone with the link joins.
- **Hello-proof replay.** A member can replay another member's hello proof from its own transport peer and receive
  content frames it can't read (metadata only). Binding the proof to both ends' sender ids would close it.
- **A reload while knocking** knocks again from the start (the record keeps only the newcomer's keys); the host sees
  a new card.
- **Epoch growth.** A room goes through at most 32 epochs (removals); each bundle carries every epoch's roster. A
  compacted chain (the current epoch's start, with a host-signed summary of the ones before) would lift both.
- **Re-keying an empty room.** A removal with nobody else here wraps for everyone in the roster; the wraps are kept
  only by the remover until someone comes back.
- **The knock card's identity.** The card names the knocker by the name they typed (unverified, as everywhere); a
  short fingerprint of their key would help a host tell two "Anonymous Wren"s apart.
- **A demoted co-host's fork.** A co-host demoted (not removed) in the last closed epoch can still sign entries there
  claiming to predate the demotion, and from them an epoch of its own. Members follow it only forward and only if it
  brings back nobody they removed, so it can't readmit anyone, but it can take roles back in its branch. Removing
  them (not just demoting) closes it.
- **Concurrent removals** converge by the winning side carrying out the other's removal: one extra epoch, and the
  losing side's members wait for it.
- **Carry-over after a demotion.** Someone let in at the same moment as a removal is let back in on their own only if
  whoever let them in still hosts or co-hosts; otherwise they knock and wait. Rare, and safe; a host-signed summary
  at each epoch's close would let the room carry them over regardless.
- **The door's pool under churn.** People at the door share a pool of 32 lobby sender places, the least recently
  heard going first: a link holder with many connections can push knockers out, who come back on their next hello
  (every 5 s), as with knock cards. A cap per tracker peer would bound it further.
