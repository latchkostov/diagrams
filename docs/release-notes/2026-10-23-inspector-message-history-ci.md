## Inspector Message history CI compatibility

The Inspector's Message-delivery regression now expects the bidi isolation around rates added by
the resilience UX changes. CI run 40014977964 showed nonzero observed deliveries, but its older
`Now [1-9]` assertion rejected the invisible isolation mark before the number. The assertion still
requires nonzero traffic, Delivered vitals and no request retry section.

Runtime behavior is unchanged: Message connections plot observed deliveries, and Request failure
rates remain unavailable (`—`) when settled-success accounting is absent. Removing isolation or
inventing a success denominator would break those existing contracts. No parity golden changes
are intended or re-recorded.

The head's Benchmarks run 40014978090 passed 94 of 95 gates, including every bundle gate. Its only
failure was the known `checks/compileTopology-per-run` issue addressed separately by PR #262.
