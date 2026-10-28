## Checkpoint retention UX review

This performance change adds no chrome, inspector fields or tuning controls. The byte cap
is an internal default. Saved-run scrubbing still restores an earlier checkpoint and
replays to the requested position; sparse older checkpoints improve coverage across a
long run rather than retaining only the origin and its last two minutes.

Mutable nodes and edges remain detached because they contain changing status, queues,
routing credits and resource ownership. Sharing them would risk changing past playback.
Only replace-only configuration and the established copy-on-write recordings are shared.
An oversized snapshot falls back to replay; the user never loses access to an earlier time.
No new public showcase is needed: this changes the existing seek implementation rather
than adding a simulation, planning or stencil feature. Deterministic output must remain
identical, with zero changed goldens.
