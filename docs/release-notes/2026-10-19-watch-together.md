## Edit together: Watch Live together (shared Live P2)

The room's host can show their Live to everyone in the room. This is the meeting host and shared Live design's
second slice, built on P1's control log. The owner's defaults apply.

- **Offered, not imposed.** When the host (the room's creator) turns on Live, everyone else gets "Sam is showing
  Live: Black Friday" with **Watch**. The chip's menu offers **Watch Sam's Live** too. Nobody follows
  automatically.
- **Lockstep, not a stream.** A follower's page runs the same simulation about half a second behind the host. It
  gets each op of the host's control log on its tick, a clock beacon twice a second and a state digest every 5
  simulated seconds. So play, pause, speed, scrubbing, the simulation, live tweaks (replicas, slowdowns, faults,
  injections) and Inputs & capacity changes (entry rates, multipliers, overrides) land on the same tick for
  everyone. A follower whose digest differs rebuilds the run from its start; twice on one run, it watches on its
  own instead.
- **Joining late.** Whoever starts watching mid-run gets the run's start and its whole log from the host, and
  catches up from the start in slices ("Catching up…").
- **When the host's connection drops,** followers hold where they are ("Sam's connection dropped. Waiting…") and go
  on when it's back. Nobody is promoted in their place. If the host leaves, followers keep their run, on their own.
- **Your own view and keyboard.** The host's camera never moves yours. **Follow Sam's view** in the chip's menu is
  opt-in and off by default; your own pan or zoom ends it. It goes through the canvas camera as a new policy row
  (`host.view`, H1 and H2). Your own action on the run (a tweak, play or pause) means you watch on your own from
  there.
- **Cooperative.** Frames are sealed with the room's key on a new encrypted `live` channel, which has its own sender
  subkeys and rate bound. Followers trust whoever's presence says it's the host. `EDIT-TOGETHER.md` says so; signed
  roles come in P4.
- **Smaller first loads.** To keep the live view and the canvas within their budgets, two things not needed for the
  first view now load lazily:
  - Record video's code (about 4.8 KB gzip) loads just after the live session starts;
  - the keyboard shortcuts sheet (about 2.3 KB) loads when it's first opened.

  Everything Watch together needs lives in the room's chunk. The live view reaches it through a small bridge
  (`src/live/watchBridge.ts`).

## Verification

- **Unit (`liveShare.test.ts`):** two real live controllers over an in-memory room channel, frame by frame on fake
  timers.
  - Every digest the host sends matches through replicas, an entry-rate rebuild and an outage, and after a pause the
    follower is in the same state on the same tick. Dropping the follower's handling of a props op makes it fail.
  - The follower stays 20 to 120 ticks behind and never passes the host.
  - A late joiner lands on the same state.
  - When the host's connection drops, the follower holds, and goes on once it's back.
  - A local action ends following, and an engine-version mismatch is refused.
- **Camera policy:** the H1 and H2 rows are tested.
- **E2E (`watch-together.spec.ts`):** two browsers in a room, with real WebRTC and the tracker emulated.
  - The host plays Black Friday and changes Payments' replicas and the shopper's entry rate mid-run. The guest
    follows from the toast's Watch and, after the host pauses, is on the same tick with the same digest.
  - A late joiner gets the same result.
  - When the host's page hangs, the guest holds and then resumes.
  - The host zooms without moving the guest. Follow the host's view is off until turned on, then takes the host's
    zoom, and the guest's own wheel ends it.

  16 of 16 across four repeats; the collab, Live, recording, presenting, shortcuts and accessibility specs pass too.

- **Parity:** `node/i18n/catalogs.json` is re-recorded for the 12 new English messages. Every locale gains them as
  English fallbacks; nothing else changed.
- **Bundle,** gzip, against master:

  |                   | master    | now       | change   |
  | ----------------- | --------- | --------- | -------- |
  | live session      | 134,989 B | 130,184 B | −4,805 B |
  | canvas first view | 382,347 B | 379,997 B | −2,350 B |
  | startup           | 176,050 B | 176,047 B | −3 B     |
