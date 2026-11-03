## Cache agreement at coarse sampling scales (#431, round 2)

Statistical cache freshness now uses the shared Expected formula while fills are healthy. Pending fills have a bounded progress clock; overdue or failed fills fall back to the last successful fill's TTL. Arrivals cannot extend either deadline. This removes a second expiry penalty when sampled misses are farther apart than a short TTL, while retaining the paused-origin and failed-fetch protections.

The reviewer cases use one Even item, a 100 ms TTL and a 10 ms fetch. Over the steady 40–60 s window across seeds 1, 7, 17, 42 and 99:

- At 200 requests/s and scale 10 (20 dots/s), Expected is 86.9565% and Live is 87.0000%, previously capped at 66.67%.
- At 200 requests/s and automatic scale 5 (40 dots/s), mean Live is 86.9250%, previously capped at 80%.
- At 2,000 requests/s and automatic scale 50 (40 dots/s), Expected is 90.4977% and mean Live is 90.5000%, previously capped at 80%.

Automatic scale and dot rates are unchanged. The agreement gate now covers every item count from 1 through 20 at automatic scale, and the property sweep includes smaller item counts and automatic scale alongside scales 1 and 10. The 2- and 3-point bounds are unchanged. Pending count and progress time are checkpointed in bounded scalar storage; pause/recovery replay is covered.

No golden changes are intended. No new controls or UI wording are introduced.
