## Low-zoom export still needs a proven performance repair

Baseline Nightly 41253920016 fails all three repetitions of the low-zoom SVG comparison. Completed captures have matching digests. Each test opens two real canvases and captures six natural-drawing SVGs, at 40%, 25% and back at 100%. Each SVG is about 9.46 MB. Below 60%, capture deliberately restores the natural drawing before cloning; the completed traces do not show a stuck geometry-readiness wait.

The baseline Linux trace spends about ten seconds opening the two canvases, then 8.2/6.8 seconds on the first capture pair and 4.5/3.4 seconds on the next. The whole-test deadline arrives during the remaining work. A native Windows profile attributes substantial work to copying computed CSS declarations and serializing the clone; an unconstrained single capture takes about 0.79 seconds. Three simultaneous repetitions on two CPUs reproduce three deadline failures, so the cumulative work is sensitive to contention.

Rejected experiments are restored, not shipped:

- Complete computed-style caching is slower in same-page comparisons; only 370 of 993 blocks are identical once initial inline styles and every computed value count. A later sparse key that still represents every value also stays byte-identical but slower in all three paired trials (370 hits among 995 blocks).
- Batching custom properties preserves bytes but is slower. Template/difference and bulk declaration parsing experiments change serialized style bytes, so they are unsuitable for a pure performance repair. No golden is updated to accept them.
- Splitting comparisons, serial reference/capture pages, reusing one page across fresh loads and disabling per-frame trace capture do not repair the constrained Windows deadlines. All original captures and exact digests remain in the original test.

The next repair must reduce actual clone/serialization or cold-load work while retaining exact output and the existing deadline. No timeout, tolerance, budget, skip, quarantine, retry or export-output changes are made. A green isolated run is not evidence that this intermittent native failure is fixed.
