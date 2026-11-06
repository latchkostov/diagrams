## Caching lessons: a shorter stampede replay and warm stale windows

A cache stampede's replay is read at its end, so Skip, Show me and the learner all played the whole saved run: 40 s
at 400 requests a second, the longest replay in the catalog. The lesson now starts from the public example with its
expiry comparison (TTL only, One fetch per item, Serve stale) cut to 15 s. The herd still forms within four seconds
and every chip settles as before on each tested seed. The public example keeps its 40 s runs, where the herd keeps
growing. The replay check reads the run's own length, so the two cannot drift apart.

A run starts its cache in steady state. Tracked hot items ignored a rule's stale window when drawing that state, so
about one seed in ten started the stale lesson's single item absent: its cold fill counted about 30 misses, and the
refresh step's 99.9% hit ratio then needed 150 s of run. Such items now draw the same servable share as untracked
items already did, so a stale window never starts its hot item absent. Seeds that already started warm are unchanged.

Completion checks, backstops and test assertions are unchanged. No parity golden changes.
