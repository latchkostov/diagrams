## Relay enforcement (shared Live P6) follow-ups

- **Role filtering on the relay (option A).** The relay enforces admission and Remove only (owner decision,
  2026-10-20). Dropping viewers' edits and non-drivers' Live there would need each channel split by class in the
  clear envelope header (doc mutations from doc control, the Live run from Live requests), with every page refusing
  a message in the wrong class. Do it if a self-hoster needs it.
- **Rooms without knock-to-join.** v1 and v2 rooms are forwarded as before; once v2 links are retired, the relay can
  refuse a hello without a root.
- **The door's places.** Someone at the door holds one of the room's eight places while knocking; a separate, small
  door quota would keep a flood of knockers from filling a room.
- **Admission after a restart of a large room.** A full-capacity chain is checked at 2,048 signatures per 10 s per
  socket: after a relay restart, a large room's members are admitted again within a minute or two. A host-signed
  summary of closed epochs would shorten it.
