## The remaining unfinished cohort is a whole-file scheduling limit

Completed baseline Nightly 41245495563 has no unfinished Windows or macOS cases. Its source tree is identical to starting master f843d13ac. Linux Build shard 1 reaches the unchanged 30-minute action deadline with 729 of 915 cases complete and 186 unfinished. The checkpoint names three running tutorial cases; 630 completed cases in the pointer-tutorial file alone account for 4,828.747 worker seconds. This is an oversized cohort, not evidence for a per-test timeout increase.

The two generated pointer sweeps now occupy four whole spec groups. Shared execution helpers retain every original action, exact completion/ownership assertion and existing quarantine flag. Test declarations stay in their spec files so Playwright reports and the timing planner can attribute their cost to the correct shard.

Before/after Playwright discovery has exactly the same 264 project/test identities across the original file and the four groups. The new completeness unit compares both registered paths and all catalog metadata. Temporarily duplicating one partition makes that unit fail; restored, the completeness and shard units pass 27 cases.

Timings are regenerated from the completed baseline's production reports. The complete Dev reports supply only identities without a successful production observation, including cases the interrupted shard never reached. No duration is hand-edited. This refreshes the formerly missing keyboard/suite weights as well as attributing the moved pointer cases to their new files. The new production-weighted twelve-shard plan is about 1,287 worker-seconds per shard, including the largest remaining tutorial file; job and test limits are unchanged. One existing unmeasured spec retains the planner's mean fallback.

Local browser repetitions and the final dispatched native counts are recorded in the round-four verification fragment and PR. No new test, skip, quarantine, retry, timeout, tolerance, budget or output golden is introduced by this partition.
