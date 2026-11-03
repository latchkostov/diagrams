## Cache core review fixes (#427, round 1)

The fixes add no controls, menu items or visible copy. The chrome budget is unchanged. Rejecting an
unsupported stencil edit uses the existing error path and retains the complete last accepted
document, including saved overrides and unrelated edits. This follows the no-surprises contract.

Creating a simulation works before opening Live. Playback still waits for the cache chunk using the
existing loading and recovery surface. Initial traffic warms a run; later peak traffic determines
sampling. An unused rule no longer makes a busy run prohibitively expensive.

The statistical tail remains an approximation. Its rule-level freshness deadline is seeded only
for warm runs and renewed by successful statistical fetches. An origin outage cannot extend that
deadline. Tracked entries retain their individual expiry and first-successful-fill behavior.

No new showcase is needed for this core-only fix round; the public Lab fixture and the routed
agreement regression exercise the corrected behavior without adding UI scope.
