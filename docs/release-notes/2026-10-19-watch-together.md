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
- **Only the room's diagram.** The host shares, and a follower follows, Live on the room's own diagram only. Live on
  any other diagram (a Private one included) is never attached, so its simulation's title never reaches presence
  and its definition never reaches the channel. Watch opens the room's diagram first. Sharing stops the moment the
  diagram on screen, or its privacy, changes, and every send checks again.
- **Owned by the room.** Watch together lives as long as the room's session, not the top bar's chip. Presenting
  (which hides the top bar) no longer stops the host sharing or a follower following.
- **Every new run, the same way.** A new run (Restart, another simulation, Play after the run finished) and a late
  joiner's request get one bootstrap: the run's start, its log, then the host's clock with the last slice. A
  follower resets everything per run and holds still until it has rebuilt. The host's run is keyed on the
  controller's run id.
- **Joining late.** Whoever starts watching mid-run gets the run from the host this way, and catches up from the
  start ten ticks at a time, checking its deadline between them and yielding to the page ("Catching up…").
- **Any size.** Messages larger than a frame (an 80-note simulation's start, a long log) go in parts and are
  reassembled, bounded in bytes and time. Logs are sliced by size, not count. A run too large to send stops being
  shown, and the host is told why.
- **Nothing waits forever.** An op that went missing (the host's connection dropped) is noticed by the next op or
  digest; the follower asks for the run again and rebuilds. Unanswered asks, and rebuilds of one run, are bounded,
  after which it watches on its own. Answers are bounded per peer and coalesced when several ask together.
- **Seeks as they arrive.** A seek back drops the branch it abandoned (ops and digests a follower hadn't reached),
  then applies at once if it's near and replays from the start if it's far.
- **Checked in full.** Every message and every nested op is checked before use (`src/collab/room/liveWire.ts`):
  shapes, bounded numbers, sequences, ticks, nesting depth and collection sizes. A malformed one is dropped without
  touching the follower.
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

- **Unit (`liveShare.test.ts`):** two real live controllers over an in-memory room channel, through the real wire
  format with the session's frame limit, frame by frame on fake timers.
  - Every digest the host sends matches through replicas, an entry-rate rebuild and an outage, and after a pause the
    follower is in the same state on the same tick. Dropping the follower's handling of a props op makes it fail.
  - The follower stays 20 to 120 ticks behind and never passes the host.
  - A late joiner lands on the same state.
  - When the host's connection drops, the follower holds, and goes on once it's back.
  - A local action ends following, and an engine-version mismatch is refused.
  - It keeps following across a host restart, another simulation and Play after the run finished: four runs, the
    same state after each pause.
  - It recovers commands missed during a host disconnect (found by the next digest), and a missing op found by the
    next one.
  - A seek back behind ops the follower hasn't applied, near and far, lands on the host's state.
  - An 80-note simulation and a 300-op log reach a late joiner in parts; catch-up never advances more than ten ticks
    between deadline checks.
  - Malformed messages (`step` with `simMs: 1e20`, `op: null`, an injection of 10¹² messages, a 40-deep patch, bad
    beacons, logs and run ids, broken parts) are dropped and the follower carries on.
  - A follower that can't get the run gives up after its bounded asks; asks together get one answer.
- **Unit (`watch.test.ts`):** the room on A and a Private B in Live: nothing about B is published or sent, then A is
  shared, and back on B only a stop goes out. An ordinary diagram that isn't the room's isn't shared; the room's
  diagram made Private stops sharing before anything else is sent; a follower asked to watch goes to the room's
  diagram first; a watcher disposed while the live view's code loads never attaches. Loosening the identity check
  makes the first two fail.
- **Camera policy:** the H1 and H2 rows are tested.
- **E2E (`watch-together.spec.ts`):** two browsers in a room, with real WebRTC and the tracker emulated.
  - The host plays Black Friday and changes Payments' replicas and the shopper's entry rate mid-run. The guest
    follows from the toast's Watch and, after the host pauses, is on the same tick with the same digest.
  - A late joiner gets the same result.
  - When the host's page hangs, the guest holds and then resumes.
  - The host zooms without moving the guest. Follow the host's view is off until turned on, then takes the host's
    zoom, and the guest's own wheel ends it.
  - The guest keeps following when the host restarts, then switches to free play.

- **Parity:** `node/i18n/catalogs.json` is re-recorded for the 14 new English messages. Every locale gains them as
  English fallbacks; nothing else changed.
- **Bundle,** gzip, against master:

  |                   | master    | now       | change   |
  | ----------------- | --------- | --------- | -------- |
  | live session      | 134,989 B | 130,213 B | −4,776 B |
  | canvas first view | 382,347 B | 379,994 B | −2,353 B |
  | startup           | 176,050 B | 176,042 B | −8 B     |
