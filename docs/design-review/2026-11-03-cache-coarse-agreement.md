## Statistical freshness at coarse scales

Chosen: approved design (b). Healthy statistical bands with positive planned demand use the shared renewal formula between sampled fills. Unplanned injections retain fill-bounded expiry. A pending-fill progress clock detects stalled origins; failure or overdue progress restores fill-bounded expiry. Successful replies can restore availability, while arrivals cannot renew it. The progress state uses two scalars per rule and is included in checkpoints.

Rejected: reducing automatic scale for every short-TTL rule. That spends more playback work, cannot repair explicit scale 10, and still reaches a tick-resolution limit at scale 1. Also rejected: renewing freshness from arrivals, removing the outage deadline, widening agreement bounds, or changing Expected to hide the discrepancy.

The reviewer cases retain 20 dots/s at explicit scale 10 and 40 dots/s at automatic scales 5 and 50. No chrome, controls, layout, narration or readout scope changes. The user sees Expected and steady Live agree, with hits still stopping during an origin pause or outage. The existing sampling caveats remain documented.

## Long-TTL finite-window quarantine

One tracked item with a 30 s TTL can have no expiry in a 20 s observation window. At 200 requests/s with a 1,510 ms fetch, Expected is 95.1928%, but seed 18 measures 100% at scales 1, 10 and automatic 5. Seeds 16–20 average 98.02% at scale 1, also outside its 2-point bound. These are explicit `it.fails` cases and a documented known gap, as the round-two fallback permits.

Rejected: forcing tracked outcomes to match the formula in every short window, extending the window, increasing seed or runner budgets, or widening tolerances. Tracked expiry must remain real, including its herds and outages. The original broad sweep remains intact; the new small-item sweep targets short TTLs at automatic scale. No new user-facing control is warranted by this fix.
