## CDN PR 4: the hard-purge lesson does not recover within the approved run

Implementation stopped at the brief's explicit condition: if a story's lesson cannot hold, stop and report.
The local work is incomplete and has not been published. No parity goldens were changed.

The existing small example has 400 requests/s, 80% for one launch item and 20% for
20,000 other products. Product API has four threads, 60 ms of local work and a
blocking database call. The new comparisons preserve that diagram and its chip
thresholds. Both storing rules get a 30 s stale window; soft purge needs a window
on both rules to retain both sets of copies.

A hard purge at 15 s removes the warm contents. Across seeds 1, 7, 17, 42 and 99,
the peak API backlogs are 790, 815, 781, 801 and 793. Shopper p95 ends at 2,050 ms
for every seed, above the unchanged 300 ms chip. The approved lesson describes a
brief overload followed by recovery and singles out the backlog chip as failing.
The local regression now asserts those approved chip outcomes and exposes the
mismatch. TTL-only and One fetch per item keep their prior assertions; Serve stale
while refreshing and Soft purge pass all three chips for every seed.

The stricter approved-story assertion fails for all five seeds. In four seeds the
item-fetch chip also fails: its metric is the maximum across all tracked items,
despite the authored label naming only the launch page. This is a separate mismatch
to resolve without weakening the chip.

Do not weaken the latency or backlog assertions, extend the run, change the origin
pool or reduce the product working set silently. A decision on the example's
story or sizing is needed before resuming. The other requested work and gates
remain unfinished, including the Black Friday deploy story, translations, parity,
bundle checks, independent property sweep, Linux browser suites and screenshots.

Before any feature edit, Black Friday `planScaling` measured 965.6 ms cold and
723.7, 672.8 and 678.5 ms warm, without memoization. Each call played four stories,
11,248 ticks and 25,218 messages. There is no after measurement: that example has
not been changed.
