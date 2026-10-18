## Relay review fixes UX review

These changes affect the optional relay infrastructure and transport contract. No controls,
chrome, labels, focus, layout or simulation behavior change. A refused upgrade follows the
existing unreachable-server reconnect path; room-cap refusals retain their established status.
The negotiated capacity is accurate, and payload configurations that cannot sync documents
fail at startup rather than leaving users connected without recovery. No showcase is needed
for this infrastructure correction.
