## Cache agreement at coarse sampling scales (#431, round 2)

Statistical cache freshness now uses the shared Expected formula for positive planned demand while fills are healthy. Unplanned injections keep fill-bounded expiry. Pending fills have a bounded progress clock; overdue or failed fills fall back to the last successful fill's TTL. Arrivals cannot extend either deadline. This removes a second expiry penalty when sampled misses are farther apart than a short TTL, while retaining the paused-origin and failed-fetch protections.

The reviewer cases use one Even item, a 100 ms TTL and a 10 ms fetch. Over the steady 40–60 s window across seeds 1, 7, 17, 42 and 99:

- At 200 requests/s and scale 10 (20 dots/s), Expected is 86.9565% and Live is 87.0000%, previously capped at 66.67%.
- At 200 requests/s and automatic scale 5 (40 dots/s), mean Live is 86.9250%, previously capped at 80%.
- At 2,000 requests/s and automatic scale 50 (40 dots/s), Expected is 90.4977% and mean Live is 90.5000%, previously capped at 80%.

Automatic scale and dot rates are unchanged. The agreement gate now covers every item count from 1 through 20 at automatic scale. A dedicated property sweep covers that range with 100, 200 and 400 ms TTLs, all popularity presets and varied rates and fetch times. The original broad sweep retains its 20–20,000-item domain and adds automatic scale alongside scales 1 and 10. The 2- and 3-point bounds are unchanged. Pending count and progress time are checkpointed in bounded scalar storage; pause/recovery replay is covered.

Parity verified all 3,302 goldens unchanged. No new controls or UI wording are introduced.

## Quarantined finite-window sampling gap

The expanded investigation also found a separate tracked-item corner: one Even item, 200 requests/s, a 30 s TTL and a 1,510 ms fetch in the fixed 40–60 s measurement window. Expected is 95.1928%. Seeds 16–20 average 98.02% at scale 1, exceeding the 2-point bound by 0.8272 points (2.8272 points total error). At scale 10 their average is 97.95% (2.7572 points error); at automatic scale 5 it is 98.00% (2.8072 points error), both inside 3 points. Individual seed 18 has no expiry in that window and measures 100% at every scale: 4.8072 points error, outside both bounds. That is also the maximum possible positive error for this configuration.

Four `it.fails` regressions quarantine the scale-one ensemble and the three seed-18 windows. The known-gaps list in `docs/SIMULATION.md` records the configuration and honest bound. Tracking, TTLs, sample counts, windows and agreement tolerances remain unchanged. Short-TTL agreement is fixed; few tracked items with long TTLs still do not guarantee the finite-window bounds.
