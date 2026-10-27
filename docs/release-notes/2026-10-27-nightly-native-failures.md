## Config inspector and dialog focus

Config connections keep their live details and settings as separate React children. This removes
development-mode duplicate-key errors when selecting, editing, or undoing a connection, including
Undo while Dependencies are hidden.

Closing a room dialog in development returns the keyboard to its original opener. React StrictMode's
effect replay no longer announces a closed dialog or replaces its opener with a control inside it.

## Nightly verification

The timeline and carried-message lazy-loading tests now hold both the actual development module and
the production chunk. Skill-download tests use the public download and await completion, retaining
the offline archive/playback checks and existing test backstops.

All 50 nightly jobs and their exact available failing identities are catalogued in
[the triage fragment](../backlog/2026-10-27-nightly-native-triage.md). Passing Windows replays do not
erase unresolved native/macOS observations. Both native unit jobs were interrupted; A1 + A3 shard
7/16 succeeded with 630 tests and supplied no failing seed for lane B.

Output parity: **3,178 goldens, zero changed, added, missing or stale**. No golden was re-recorded.
There are no simulation changes.
