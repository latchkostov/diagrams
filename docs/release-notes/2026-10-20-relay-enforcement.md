## Edit together: relay enforcement for self-hosted rooms (shared Live P6)

The meeting hosts design's sixth slice (§4; owner decision 15). Self-hosted only: the public tracker path is
unchanged. Not yet independently reviewed, like P4 and P5; Private diagrams stay out of rooms.

- **The relay admits only a room's members.** In a knock-to-join room, the self-hosted relay forwards the room's
  content only between members. Someone with just the link reaches the lobby, where they knock, and nothing else,
  even with a modified browser.
- **Remove closes the connection at once.** When the host removes someone, the relay closes their connection as soon
  as it has the room's new epoch, through every re-key since.
- **How.** Each browser tells the relay which member it is (a signature by its session key over the relay's
  challenge) and passes on the room's signed list of members, which the relay checks as every browser does (signatures
  only: it never has a key that opens content). Signature checks are budgeted per connection and per room. A restart
  loses nothing: browsers reconnect and say who they are again.
- **Nothing is dropped silently.** The relay answers every proof and push (`ok` or `retry`, and how much of a push it
  holds); browsers send again until they're answered in full, so a removal reaches the relay however busy it is. The
  relay's waiting work is bounded per connection and per room, and goes with its connection. Four settings tune the
  checks and the queue (`LD_VERIFY_PER_SOCKET`, `LD_VERIFY_PER_ROOM`, `LD_ADMISSION_JOBS`, `LD_ADMISSION_BYTES`).
- **What the relay learns.** Each session's public key, the room's roster (who's a member and their roles, as keys)
  and its size, and when they change. Documented in [SELF-HOSTING.md](../SELF-HOSTING.md) and the
  [threat model](../research/collaboration-threat-model.md).
- **Not changed.** Who can edit and who drives Live are still enforced by every browser (P4), not the relay; rooms
  without knock-to-join are forwarded as before. No protocol or envelope change for anyone else.
