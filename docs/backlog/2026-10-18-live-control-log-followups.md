## Shared Live P1 follow-ups (control log and determinism)

- **The live session's bundle budget is nearly used.** It's at 134,813 of 135,000 B gzip after P1, which added
  about 1.4 KB for the controller's log and 0.3 KB for the simulator. #189 (requests that wait) and P2 will need
  room. Raise the budget deliberately in the PR that needs it, or move the digest and the op listener into P2's
  room chunk.
- **Free play's rate changes still start over.** A free-play run has no checkpoints, so a new entry rate or dot
  scale rebuilds it from 0 and starts a new log (as before). Shared Live's driver should send that as a `rebuild`
  op, so followers start over together.
- **Inputs and diagram patches rewrite history.** A scrub back past a Traffic ×, a props what-if or a diagram
  props edit replays the run with the current values from the start, as before; the log records them (`inputs`,
  `base`, `commit`, `patch`) but doesn't reapply them. P2's followers must apply the same rule.
- **The Nightly engine check plays 60 s per simulation.** It covers all 77 saved example runs and the corpus isn't
  included. If WebKit or Firefox differ on a longer run, extend `UNTIL_MS` or add the corpus.
- **Where the sim clock plugs in.** `useFrameLoop` still advances by the frame clock directly. P2 passes each
  frame's step through `createFollowClock` while following.
- **Supersession is by property, for the newer edit's keys.** Changing an Inputs override back to the diagram's
  value doesn't revive the older tweak: the newer choice keeps precedence. Link faults aren't exercised by the
  replay test, because the example has no network links. Add a link cut to it with a network example.
- **A flaky style test, on master too.** fault-drills' "cut and restored Request and Message styles are distinct"
  sometimes reads the restored edge style before it settles under load. It failed 2 of 196 runs on master, and once
  in some of the runs here.
