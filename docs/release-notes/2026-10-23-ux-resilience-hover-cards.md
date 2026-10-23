## Resilience and hover cards

- Failure percentages now divide failed settled attempts by all settled attempts **since restart**, excluding local breaker rejections from both counts. The callout, Calls, connection card, breaker detail and pill explanations share that calculation. Rolling ten-second request/amplification readouts retain their separately labeled scope. No percentage is clamped and simulation behavior is unchanged.
- The retry-budget comparison leads with measured recovery: Payments returns to 300 successful checkouts/s, with 9,738 failed requests retained as the incident tradeoff. The successful throughput comes from the caller's measured throughput; ordinary arrivals can still occupy its small admission queue.
- Searching **circuit breaker** finds the existing retry-storm comparison. Its gallery card mentions the breaker that pauses failing calls.
- Request settings group waiting limits, retries, retry timing and the circuit breaker. Retry limits, safety and thresholds remain collapsed. Visible descriptions are associated with their groups; timing labels and breaker states use plain language, and breaker threshold prose reflects actual settings. Appearance & routing replaces the outer Advanced heading. Message-type controls are unchanged.
- Hover cards show their hero verdict once, avoid duplicate timeout totals, isolate numeric units and identifiers for RTL, and put recent throughput in Outcomes with **Last 10 seconds while pinned**. Now/low/peak and the per-second text alternative remain.
- Timeline events use one keyboard stop; arrows explore and announce events, with pointer access preserved. Closing a focused summary records `hadFocus` separately from pin state and restores its source on Escape.

## Output and bundle contracts

The only changed golden is `node/i18n/catalogs.json`: 20 English catalog additions and the requested resilience/gallery wording change the examples, resilience and hover fingerprints, message totals (2,851 → 2,871) and English fallback counts. No translations are authored or stamped. Every diagram, simulation, export, layout and browser golden remains unchanged.

Development focus-journal formatting is omitted from production, where that journal is already disabled. A production-build regression pins its absence. The existing lazy Request-fields and gallery boundaries contain the new controls, styling and expanded gallery copy; no new lazy recovery path or budget increase is introduced.

## Deferred owner decisions

Current health versus historical incidents, queue occupancy as attention, the verified-fix product contract/showcase, and lesson timing remain outside this change.

## Verification

The five new production browser cases passed three repetitions. Linux load verification passed 895 cases across five repetitions with eight workers, followed by 41 focused cases after sync. Post-sync parity matched all 3,111 goldens, including 101 browser cases. Lint, typecheck, formatting, i18n, skill freshness, production build, size and all four bundle gates pass; the skill ZIP is 833,939 bytes.

The standalone full unit run recorded five local simulation-test timeouts and one missed sparkline assertion for the new isolation marks. The assertion is corrected; all four affected files pass the standard CI configuration (162 tests). Clean-master timeout reproductions and isolated default-config passes are recorded in [the backlog fragment](../backlog/2026-10-23-heavy-unit-hang-backstops.md). The initial full-gate attempt exited 75 because the shared worker budget was busy; it did not run a full suite.
