## Cache readout review (#431, round 1)

The compact cache row leads with both percentages and ends with `recent ≤10s`; expanded details retain the full recent-window sentence. The production browser regression checks that the summary fits its available width in the 320 px hover card. No control or additional chrome is added.

Latency scope follows the engine's existing drill measurement reset. The cache details expose the effective fault and its simulation timestamp separately from the sampled percentiles, so an empty post-fault recorder still has an accurate scope. Cumulative rule counts keep their since-restart label.

Rejected: shortening the expanded explanation, extending statistical freshness on pending fetches, reducing automatic scale for rules that cannot track items, or relaxing agreement limits. These either hide useful context, invent cache availability, spend work without fidelity, or conceal disagreement.
