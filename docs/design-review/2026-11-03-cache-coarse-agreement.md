## Statistical freshness at coarse scales

Chosen: approved design (b). Healthy statistical bands use the shared renewal formula between sampled fills. A pending-fill progress clock detects stalled origins; failure or overdue progress restores fill-bounded expiry. Successful replies can restore availability, while arrivals cannot renew it. The progress state uses two scalars per rule and is included in checkpoints.

Rejected: reducing automatic scale for every short-TTL rule. That spends more playback work, cannot repair explicit scale 10, and still reaches a tick-resolution limit at scale 1. Also rejected: renewing freshness from arrivals, removing the outage deadline, widening agreement bounds, or changing Expected to hide the discrepancy.

The reviewer cases retain 20 dots/s at explicit scale 10 and 40 dots/s at automatic scales 5 and 50. No chrome, controls, layout, narration or readout scope changes. The user sees Expected and steady Live agree, with hits still stopping during an origin pause or outage. The existing sampling caveats remain documented.
