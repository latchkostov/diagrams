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
- **The host's ops, through the controller.** A follower applies each op through its controller's own remote-op
  API (`LiveController.applyRemote`, exhaustive over every op kind), as the host's controller applied it:
  - a saved Inputs (`commit`) carries the saved simulation and the node props the save wrote, and clears the
    what-ifs;
  - a diagram edit (`patch`) carries its props and statuses and the edited nodes' props, applied as sent on their
    tick (two edits within the half-second delay both happen; a removed key travels as null);
  - a seek goes to the tick the host's seek reached.
- **Who changed the run.** Every op is logged with its origin: this person, the room's host, or the document. Only
  this person's own change ends following. The live view's sync with the document (diagram edits, saved
  simulations edited or removed) goes through one boundary (`src/live/session/liveSync.ts`) that waits while
  following and reconciles once it ends; a draft the guest's saved list never had (the host's unsaved one) stays.
- **The run's start includes the diagram then.** Its node props travel with the start, so a rebuild replays the
  run's edits on their ticks from the props the run started with, not the latest.
- **Joining late.** Whoever starts watching mid-run gets the run from the host this way, and catches up from the
  start ten ticks at a time through an internal advance (`advanceTo`) that logs nothing and publishes nothing,
  checking its deadline between stretches, yielding to the page and publishing once a slice ("Catching up…"). It
  ends playing or paused as the host is.
- **Any size.** Messages larger than a frame (an 80-note simulation's start, a long log) go in parts and are
  reassembled, bounded in bytes and time. Logs are sliced by size, not count. A run too large to send stops being
  shown, and the host is told why.
- **Nothing waits forever.** An op that went missing (the host's connection dropped) is noticed by the next op or
  digest; the follower asks for the run again and rebuilds. Unanswered asks, and rebuilds of one run, are bounded,
  after which it watches on its own. Answers are bounded per peer and coalesced when several ask together. While
  the host's run replays after an Inputs change, it sends no beacon or digest from behind the ops it has logged
  (one could hold a follower at a digest whose op lay ahead of it).
- **Seeks as they arrive.** A seek back drops the branch it abandoned (ops and digests a follower hadn't reached).
  It's applied at once only when the controller's own measure of the work (`seekCost`, to the tick the host
  reached) is small; further ahead it goes in slices, further back the run is replayed from its start. A seek whose
  tick is past its target isn't taken.
- **What a follower keeps is bounded.** A run's log, bootstrap and ops together, past 1 MiB or 20,000 entries ends
  following with a message; waiting digests are at most 32, each kept once. A beacon or digest naming a run the
  follower doesn't know (the host restarted while the connection was down) asks for it.
- **Ending Live isn't a dropped connection.** A host who stops showing Live (back to editing, another diagram) ends
  following with "Sam stopped showing Live", not a wait for a connection that's fine.
- **Checked in full.** Every message and every nested op is checked before use (`src/collab/room/liveWire.ts`):
  shapes, bounded numbers, sequences, ticks, nesting depth and collection sizes. A malformed one is dropped without
  touching the follower.
- **When the host's connection drops,** followers hold where they are ("Sam's connection dropped. Waiting…") and go
  on when it's back. Nobody is promoted in their place. If the host leaves, followers keep their run, on their own.
- **Your own view and keyboard.** The host's camera never moves yours. **Follow Sam's view** in the chip's menu is
  opt-in and off by default; your own pan or zoom ends it, and so does keyboard navigation that reveals a node. It
  goes through the canvas camera as new policy rows (`host.view`, H1 and H2; a reveal while following, H3). Your own action on the run (a tweak, play or pause) means you watch on your own from
  there.
- **Cooperative.** Frames are sealed with the room's key on a new encrypted `live` channel, which has its own sender
  subkeys and rate bound. Followers trust whoever's presence says it's the host. `EDIT-TOGETHER.md` says so; signed
  roles come in P4.
- **Smaller first loads.** To keep the live view and the canvas within their budgets, two things not needed for the
  first view now load lazily:
  - Record video's code (about 4.8 KB gzip) loads just after the live session starts;
  - the keyboard shortcuts sheet (about 2.3 KB) loads when it's first opened, through the app's recoverable
    `lazyComponent`. Its frame shows at once: loading, or a failed download with Retry and Close; Escape closes
    it and focus goes back to what opened it. A failed download never blanks the canvas.

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
  - Free play's Inputs change (it starts over) is shared as a new run, and followed to the same state.
  - While the host replays, no beacon or digest goes out from behind its logged ops; removing that check fails it.
  - The host's ops through the controller: an Inputs save then a newer Inputs edit; free play's 3 replicas saved
    to the diagram, then edited to 5; two diagram edits within the playout delay (both happen, no rebuild); the
    host editing, then removing, the saved simulation while followed; an unsaved host draft.
  - A restart while the host's connection is down; the host's paused state after catching up.
  - Ten minutes of catch-up log no synthetic ops and publish under 40 times (it was 6,002 ops); catch-up yields at
    its deadline with a clock that moves with the work, and a follower disposed between slices replays no more.
  - A seek whose target says more than its tick; a run past the receive bounds; waiting digests bounded and kept
    once; one digest mismatch rebuilds, a second gives up, and a new run starts the count over.
  - Each of these fails with its fix taken out (checked one by one).
  - 11,927 unit tests pass after rebasing on #189.
- **Unit (`watch.test.ts`):** the room on A and a Private B in Live: nothing about B is published or sent, then A is
  shared, and back on B only a stop goes out. An ordinary diagram that isn't the room's isn't shared; the room's
  diagram made Private stops sharing before anything else is sent; a follower asked to watch goes to the room's
  diagram first; a watcher disposed while the live view's code loads never attaches; a host who stops showing Live
  ends following as that, not as a dropped connection. Loosening the identity check makes the first two fail.
- **Controller (`controlLog.test.ts`):** ops reach listeners with their origin; `advanceTo` logs and publishes
  nothing; a remote seek goes to the tick the host reached.
- **Camera policy:** the H1, H2 and H3 rows are tested.
- **E2E (`watch-together.spec.ts`):** two browsers in a room, with real WebRTC and the tracker emulated.
  - The host plays Black Friday and changes Payments' replicas and the shopper's entry rate mid-run. The guest
    follows from the toast's Watch and, after the host pauses, is on the same tick with the same digest.
  - A late joiner gets the same result.
  - When the host's page hangs, the guest holds and then resumes.
  - The host zooms (Ctrl+wheel; the test checks the host's zoom changed) without moving the guest. Follow the
    host's view is off until turned on, then checked, and takes the host's zoom and centre; the guest's own wheel
    ends it.
  - The guest keeps following when the host restarts, then switches to free play.
  - Presenting, for the host and then the guest (no top bar, no chip), stops neither sharing nor following.

  The spec's seven tests pass 48 of 48 at eight repeats with six workers; with the collab, Live, recording,
  presenting and accessibility specs, 179 of 179; the capacity, planning, simulation and slow-motion specs 111 of 111.

- **E2E (`lazy-loading.spec.ts`):** the shortcuts sheet's download fails: its frame says so with the canvas intact;
  Escape closes it with focus back on the button; Close does too; Retry opens the sheet.

- **Parity:** `node/i18n/catalogs.json` is re-recorded for the 16 new English messages. Every locale gains them as
  English fallbacks; nothing else changed.
- **Bundle,** gzip, against master (with #189):

  |                   | master    | now       | change   |
  | ----------------- | --------- | --------- | -------- |
  | live session      | 133,321 B | 129,618 B | −3,703 B |
  | canvas first view | 382,737 B | 380,984 B | −1,753 B |
  | startup           | 176,313 B | 176,323 B | +10 B    |

  Startup's code is unchanged. The entry now names two more lazy chunks (Record video and the shortcuts sheet),
  and the chunks' content hashes moved; that's the 10 bytes. Every budget is as it was. The live session grew
  about 1.1 KB on the last round (the remote-op API, origins, the sync boundary) and the canvas about 0.6 KB (the
  shortcuts sheet's frame).
