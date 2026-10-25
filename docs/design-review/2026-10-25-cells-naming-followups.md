## Naming completion and quota feedback

The CI trace for run 40236377070 reaches Evacuate a region, adds the Load Balancer, presses Enter,
then loses Alt+Right before searching for Go Service. A controlled-clock browser regression holds
measurement frames across that same sequence. The placement type-ahead capture retained keyboard
ownership after Enter; useCanvasShortcuts consequently ignored the next shortcut. Releasing the
capture on completion preserves its buffered result for the reveal callback while allowing the
next action on the selected node.

The placement implementation was unchanged by the original PR and is also present on master.
Ten ordinary native cells repetitions and two CPU-throttled repetitions passed before the repair;
the held-frame regression failed before it and passed after it. This establishes the scheduling
defect, but does not establish which original PR change made its CI occurrence more likely. The
quota, rule mapping, planning and readout guards remain intact. The lesson did not rely on an
incorrect simulation behavior and remains unchanged.

No controls or chrome are added. Enter/Esc retains its existing meaning, and the next shortcut acts
on the new selection. Bulk quota feedback remains beside and accessibly linked to the disabled
input regardless of selection order. Existing rates at the ceiling remain editable and clearable.

Rejected: adding waits to the lesson driver, extending timeouts, changing the lesson's solution,
rolling back the waiting-mutation filter without causal evidence, and materializing unrelated
rule identities. The collision repair tracks affected fallback bases as well as explicit owners.

## Verification

The four targeted unit files pass all 45 tests. The new mixed-identity test fails without the repair;
removing the bulk disabled-state override fails the available-first case. The held-frame browser
regression fails at the missing quick-add search without the naming repair.

Production Chromium passes tutorials.spec.ts, inline-edit.spec.ts and owner-decisions.spec.ts:
160 passed, 10 existing quarantined cases skipped, no failures or retries. The cells solution then
passes ten further repetitions with four Chromium workers. The planning/admission and i18n parity
checks compare 180 goldens with no changes, additions, missing or stale files.
The production build and size checks pass; entry gzip is 108.1 kB against 123.5 kB.

The attempted targeted Linux gate exits 75 because the shared worker budget is occupied. It emits
no SUMMARY line and runs no browser tests. No full gate or full suite was started in this fix round.
