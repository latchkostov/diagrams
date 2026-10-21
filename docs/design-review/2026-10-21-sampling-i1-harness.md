## Sampling I1 harness review

This batch changes test infrastructure and accuracy evidence only. It adds no product controls,
UI copy, runtime paths or user flows. The chrome budget and existing interactions are unchanged.
Expected failures retain the approved bounds and exact-equality contracts; ordinary measured
siblings ensure an unrelated crash cannot disguise a sampling regression.
