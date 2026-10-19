## Edit together: a copy with no collaboration servers says so

When a build names no matchmaking tracker, a room can never find anyone. Rooms used to show "Could not connect to
this room." after the wait, as if the network were to blame. The owner hit this on an e2e-build preview, which has
no endpoints unless a test injects them. A room in such a build now says so plainly: "This copy of Live Diagrams
has no collaboration servers set up." (with the copy's own name), plus a hint for whoever runs it: "name them with
VITE_COLLAB_TRACKERS when you build it".

- **Before anything connects:** the start and join dialogs show this sentence in place of the services list.
- **After the wait:** the room's alert and the joiner's waiting screen use it in place of "Could not connect", with
  `data-reason="no-trackers"`. The chip says "No collaboration servers".
- **Unchanged:** Save a file copy, Retry and Leave all stay. Production builds always name trackers: unset, they
  get the approved public ones, and a malformed list stops the build. So this only shows where a build really
  has none.

## Verification

- **New e2e:** "a build with no trackers says so plainly, to the one who starts a room and to a joiner". It covers
  both dialogs, the alert (axe-clean), the chip, and the joiner's failure with its reason.
- **"Matchmaking unreachable"** used to stand in for an unreachable tracker by having no tracker at all. It now
  uses a tracker whose every socket closes at once, so it still tests "Could not connect".
- **The shared `startRoom` helper** (from E8) checks the services line. Without a tracker, it now expects the
  no-servers sentence.
- **Collab specs and `csp`:** 67 of 67 pass.
- **Parity:** `node/i18n/catalogs.json` is re-recorded for the three new English messages. Every locale gains them
  as English fallbacks, so its message and fallback counts each grow by 3 and its `collab` area hash changes.
  Nothing else changed.
