## Live startup readiness and checks responsiveness coverage

The Live toggle reports busy until the requested session has mounted. Cold-load
regressions wait for that session, and for a hover's throughput explanation,
before checking the controls or their contents. The existing UI assertions and
whole-test backstops stay unchanged.

The checks typing comparison now uses 21 adjacent pairs with the same input and
fresh findings. Previously, held blocks stayed stale after their first key while
running keys began fresh, comparing different Inspector work. Worker replies
publish after the CPU sample in both modes. The real checks worker still computes
during typing; the workload, required run count and 1.5 CPU ratio stay unchanged.
Preparation also waits for pending debounce and idle work, preventing a setup
run from blocking the sample behind a held reply.
A new AI panel regression checks that
switching diagrams through the picker clears both unapplied Advanced fields
and disables Apply.

Four quarantines are lifted after five loaded native Windows repetitions. The four
slow-motion context-close quarantines remain after two native investigation rounds:
the stalls were not reproduced, so there is no causal cleanup fix. The evidence
and remaining investigation are in the
[review](../design-review/2026-10-18-followups-nine.md). The separate paused-follow
camera issue reproduces on clean master in Windows and Linux and stays tracked
in the backlog.

Output parity checks all **2,196 goldens unchanged**: zero changed, added, missing
or stale. No golden is updated.
