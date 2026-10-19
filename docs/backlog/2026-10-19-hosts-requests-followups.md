## Hosts and requests (shared Live P3) follow-ups

P3 resolves four of Watch together's follow-ups (`2026-10-19-watch-together-followups.md`): the inert live bar, the
narration camera rule, a host already in Live, and the version wording.

- **Co-hosts' menu.** Co-hosts answer requests (the last roster stands while the host is away), but the people
  menu (co-host, drive, host) is the host's alone. Design §1 lets co-hosts do everything but change the host's role;
  that needs a roster nobody's presence owns (P4's roster log).
- **Two rosters after a partition.** A co-host's yes while the host is away changes everyone's last roster; a host
  coming back says its own, which wins. Fine cooperatively; P4's signed roster log orders them.
- **A typed controller guard.** Following turns this person's own run changes away by wrapping the controller's
  methods from the room's code (a list of method names). A controller-owned guard, typed by op and origin, would
  keep the policy in one place; it waits for the Live controller's in-flight work (#195) to land.
- **A handoff that can't complete.** The next driver starts a run of its own (followers rebuild) when it doesn't hold
  the run whole, leaves Live, or isn't level within 30 s.
- **"Already in Live" restarts the run.** Starting over at the same moment drops the run's one-off tweaks (an
  injection, a manual fault). A sendable checkpoint (P7) would share the run as it is.
- **Requests from people not following.** Ask to drive is offered only while following; someone not following asks
  to show their own Live instead.
