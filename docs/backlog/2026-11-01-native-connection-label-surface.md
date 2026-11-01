## Edit full connection labels in their readable view

Nightly 41319992759 fails the Windows firewall deny-rule test while its full connection label
detaches. The trace screenshot proves the product has settled in the calm chip view at 51%.
Chip connections intentionally have no full label, so waiting longer for that label is wrong.
The test had clicked the transient natural label during startup on faster machines.

The two rule-editor cases now explicitly zoom to the readable view and wait for viewport and
identity work to settle before clicking the full label. A new regression starts from a settled
40% calm view, verifies the full label is absent, then opens the same rule editor through the
readable view. All rule, traffic, accessibility and keyboard assertions remain exact.

This changes test setup only. No product view, low-zoom interaction, camera policy, timeout,
tolerance, budget or skip changes. Reversion and local/native results belong in the round-seven
verification fragment.

All ten file cases pass three Windows repetitions on two CPUs (thirty executions). Replacing
the readable-view helper with the old direct-label click fails the new settled-calm regression;
the exact repaired bytes are restored afterward. Linux and dispatched results are recorded in
the verification fragment.
