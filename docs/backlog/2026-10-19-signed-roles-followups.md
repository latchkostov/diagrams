## Signed roles (shared Live P4) follow-ups

P4 resolves two of the hosts and requests follow-ups (`2026-10-19-hosts-requests-followups.md`): the co-hosts' menu
and two rosters after a partition. Still open there: the typed controller guard (the Live controller is mid-change
for Requests that wait PR 3, in `src/sim` and `src/live`), a handoff that can't complete, and "already in Live"
restarting the run.

- **The crypto review.** The threat model lists what P4 adds to its scope. Until it reports, signed rooms are
  disclosed as unreviewed, and Private stays blocked.
- **Retire v1 links** after one release (owner decision 12): then a v1 link says it's from an older version.
- **A viewer's canvas.** A viewer's edit is undone with a note. A read-only canvas (no edit affordances while
  viewing) would say it before they try.
- **Making an editor a viewer again, and removing people,** need a new epoch with the content key re-wrapped
  (P5); until then, roles only add editors. A new epoch is also what cuts off a former co-host who signs entries
  claiming to predate "Not a co-host" (they can't be told from concurrent honest ones, so they count).
- **Newcomers with no lead here.** Only the host and co-hosts admit, so with both away a newcomer views until one is
  back. A "let people in while I'm away" grant to named editors (or P5's knock) would cover it.
- **A duplicated tab the BroadcastChannel check misses** shares its identity with the original: both are the same
  person, and the roles resolve to the lowest sender, but nothing re-mints the copy's key mid-session (P3 re-minted
  the member id; a key can't be re-bound to the same sender).
- **Binding races.** A peer that sees a newcomer's sender id before the newcomer's first presence could bind it
  first (a denial of service on that newcomer, not an impersonation). Knock-to-join (P5) sends the binding before
  any frame.
- **Roster growth.** Every newcomer's admit is an entry, and every drive change; a very long room could reach 1,024
  entries (or 256 from the host), and then no more role changes. A compacted roster (a signed snapshot at a new
  epoch) would lift it. Each new entry's check folds its causal past (fine at these bounds; an incremental fold
  would scale further).
- **Anti-entropy cost.** The roster summary is one small signed frame per peer every round; a full roster goes to a
  peer only when its summary differs (four times a window at most).
- **The non-host overflow.** Past 768 non-host entries (many co-hosts, each signing hundreds), which of them a peer
  keeps depends on arrival order. A per-epoch snapshot (P5) or a per-co-host share would make it deterministic.
- **Placing again on a fork.** An entry sorting before its slot's holder places the whole roster again (bounded by
  the fork limits). An incremental re-placement would be cheaper if forks ever mattered in practice.
