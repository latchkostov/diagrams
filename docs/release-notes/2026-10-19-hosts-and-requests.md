## Edit together: hosts and requests (shared Live P3)

The meeting hosts design's third slice: who hosts the room, who drives Live, and asking. Cooperative, as Watch
together is; signed roles come in P4. The owner's defaults apply (design §7: 3, 5, 9).

- **Ask to drive.** A follower asks in the chip's menu, or in "Sam is driving". The host and co-hosts get a card
  under the chip (non-modal, never taking focus): **Let them** or **Not now**, declined after a minute. On yes the
  run passes at a tick: the old driver hands it over (a `handoff` with its tick and last op), goes on following it,
  and the new driver, once its own run is level with the handoff, drives the same run on. Nobody rebuilds.
- **Show my Live to the room.** Someone in Live on their own asks to show it; on **Show everyone** they drive a new
  run from their simulation (unsaved drafts included).
- **Roles.** The host's people menu: **Make co-host**, **Let them drive** / **Take back Live**, **Make host** (the old
  host becomes the first co-host; who drives stays). The host's presence carries the roster (co-hosts, the driver);
  the people list says host, co-host and driving.
- **Leaving on purpose** hands the room to the earliest co-host, else to whoever has been here longest, and the run
  to the next driver. A dropped connection still hands nothing over: followers wait, nobody is promoted.
- **Following, the live bar is inert.** Its buttons don't act; using one opens "Sam is driving" with **Ask to
  drive** and **Watch on my own**. A change made another way is put back (the run is rebuilt, without counting as
  drift), replacing P2's "watching on your own".
- **Notes don't take a view you moved.** A new camera row (L10): while following, a narration note's focus keeps
  the view of someone who moved it by hand.
- **A host already in Live** whose run can't be described from its start (Inputs changed since, say) starts it over
  at the same moment, so the room watches the same run; the host is told.
- **Neutral wording.** A version mismatch says "a different version of Live Diagrams", and to reload both pages.
- **Driver-owned numbering.** A shared run's ops are numbered by the run, not by one controller's log, so the next
  driver goes on from the last number.

Everything new lives in the room's chunk. The live view and the canvas only gain types and one camera row; the
shortcuts sheet's frame lost its own Tab handling (everything behind it is inert, so Tab can't leave it) to make room.

## Verification

- **Unit:**
  - `liveShare.test.ts`: the host hands the run to a follower at a tick; the follower comes level with it and drives
    it on (same run id); the new driver changes an entry rate; the old host and a third follower land on the same
    digest, with no rebuild and no catch-up.
  - `watch.test.ts`, people in a fake room: Not now tells the asker; Let them names the new driver for everyone,
    Take back returns it; an unanswered request is declined after a minute; the host leaving hands the room to the
    earliest co-host, with none to whoever's been here longest; Make host; a co-host's yes; Show my Live; a host in
    Live with a run it can't describe starts over at the same moment.
  - `roles.test.ts` (roster, successor, the run to follow), presence's roster fields, and camera row L10.
- **E2E (`hosts-requests.spec.ts`):** two browsers: the live bar's inert play opens "Sam is driving", Ask to drive,
  Let them; the guest drives, changes the shopper's entry rate, pauses, and the old host is on the same tick with
  the same digest. A Not now: the asker is told and goes on following. Three browsers: the host makes the second to
  join a co-host and leaves; the co-host becomes host, not the first to join.
- **Parity:** `node/i18n/catalogs.json` is re-recorded for 22 new English messages (and the version message's new
  wording). Every locale gains them as English fallbacks; nothing else changed.
