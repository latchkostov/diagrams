## Reproduced work

The complete keyboard cohort under six workers/four Linux CPUs passes 77 executions on its first repetition and 76 on its second, with study-fanout reaching the unchanged whole-test deadline. Its failure screenshot has already reached the lesson-complete handoff. This is separate from the macOS missing maxDeliveryCount field observation, which is not declared repaired here.

The trace spends 10.25 seconds across 103 focus-transition polls. Each poll still observes the actual focused element; the default polling interval adds delay when the first read precedes a queued focus commit. Poll that same signal without the extra interval. Preserve every key, two-frame roving-focus observation, camera/interaction acknowledgement, cycle check and assertion deadline.

## Verification

The affected ten-lesson group passes twenty loaded Linux executions with two simultaneous repetitions. Study-fanout changes from one pass/one deadline failure in the earlier cohort to two passes; their recorded durations are 89.7 and 40.8 seconds. This small cohort is evidence of the repair's behavior, not proof that every native replay deadline or missing field is eliminated. No assertion, timeout, tolerance, budget, retry or skip changes. Final complete-cohort and native evidence belongs to the round-six verification fragment.
