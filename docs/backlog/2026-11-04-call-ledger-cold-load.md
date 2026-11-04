## Cold Dev export contention remains after call-path optimization

The fixed work/reservation layout brings warmed Black Friday sizing below 500 ms on Node. It does not justify restoring the quarantined 25% then 100% Dev SVG comparison yet.

With its existing `test.fixme` temporarily removed, the case passed 17 of 20 repeats (85%) in `mcr.microsoft.com/playwright:v1.64.1-noble`, Dev mode, three workers on four CPUs and 12 GiB memory. The first three repeats hit the unchanged deadline; the other 17 passed at roughly 26–29 seconds. Playwright reported 3 failed, 17 passed, zero retries. The original test was restored byte-for-byte.

Keep the quarantine documented in [the original investigation](2026-11-04-black-friday-dev-deadlines.md). A subsequent change still needs all 20 repetitions to pass before removing it. No export output, traffic, deadline or budget was changed here.
