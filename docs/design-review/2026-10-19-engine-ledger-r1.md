## Approved design summary

Step 1 of 5 of the logical/sampled engine split. The approved design is
`engine-logical-sampled-split.md` (2026-10-19): logical attempts decide outcomes;
an independent sampled ledger owns resource reservations and only releases them
and wakes admission. Its per-owner indexed heaps use the owner's active clock
and its own reservation IDs. Scale 1 must remain byte-identical.

R1 introduces that ledger for edge pools, indexed pending calls, invariant hooks,
generated command sequences and checkpoint state. R2 introduces attempts and
write-once outcomes; R3 migrates caller threads and request reservations; R4
migrates logical CPU and callee reservations; R5 locks in scale equivalence and
benchmarks. Deadline behavior from #197 follows those five steps.

## Scope and compatibility

R1 preserves today's delayed logical replies and nested sampled-delay accounting.
The ledger owns their pool tails; the logical reply still waits as before until
R2. Release and dispatch remain beside logical replies in this intermediate step
to preserve the existing tick phase. Pool holds use active time, so pause freezes
them and changing the sampling scale never changes an existing reservation.
The outcome diagnostic is a reserved hook; R2 will populate its attempt records.

## UX review

This internal refactor adds no controls, words, settings or public simulation
feature. The existing progressive disclosure and chrome budgets are unchanged.
No new showcase is needed. Output parity, including scale-1 simulation output,
must match every committed golden; none may be re-recorded for R1.

## Export regression fixture

The full gate caught a collision in the encrypted HTML export test: the generic
fixture word `Ledger` also occurs in the public `verifyLedger` API bundled in the
viewer. The exported fixture's title and labels were not present in plaintext.
The test now uses unique canaries for its title, node IDs and labels, and edge ID
and label, checking all seven against the entire encrypted file. This preserves
the privacy assertion and extends its field coverage without tying it to viewer
implementation names.
