## Checks typing CPU comparison — resolved

Nightly 39115946465, Build ×3 shard 3/6, reported running median 0.180236 CPU
seconds versus held median 0.114612, above the unchanged 1.5 ratio. The previous
blocks compared different Inspector state: after the first held key, findings
stayed stale; every running key started fresh and marked the findings stale again.

Follow-ups nine compares 21 adjacent pairs with the same key, prefix and fresh
findings. The Inspector's existing staleness is observable through `data-stale`;
removing preparation deterministically fails the fresh-findings assertion.
Successful worker replies are queued until after the CPU reading, and a counter
requires zero result publications inside samples. Failed replies still reach the
real fallback. Removing reply queuing alone did not reproduce early publication
on this host, including at 4× main-thread CPU throttle; that race is not asserted
as the observed cause of this Nightly failure.

The full gate found a second measurement race: balanced started/finished counts
can hide a setup check still in its debounce or idle queue. That run could start
as replies were held, blocking the sample's next run. Preparation now observes
the scheduler's existing busy state through the E2E hook. A fake-clock regression
fails when that state is replaced with the old counter comparison.

The 1,500-node workload, required worker runs and 1.5 ratio remain intact. Forcing
the real checks engine onto the main thread, while keeping a worker alive, fails
the CPU assertion at 4.59×. Native and Linux load repetitions are recorded in the
[follow-ups nine review](../design-review/2026-10-18-followups-nine.md).
