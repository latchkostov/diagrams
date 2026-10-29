## Export, Nightly and survey tooling follow-ups

The browser benchmark comparison workflow preserves its survey comparison tools from the workflow
revision before checking out either measured revision, so historical heads need not contain those
tools. Survey timings now require both saved simulations to be played with no skipped/out-of-time
notes. Live heap probes clear timing-observer history before every GC reading, including the baseline.

Regression coverage checks React's chip commit before readiness clears and natural-card restoration,
PNG font/background/mask embedding through style capture, Nightly's native matrix bindings, and
independent comparison metrics with partially incomplete groups. Product behavior, budgets and
reserves are unchanged. No parity goldens were changed or re-recorded.

The older five-minute heap observations in the survey report included retained probe history and
must not be treated as application-only retention. No replacement performance measurements are
claimed by this test/tooling batch. Inactive-chip decoration remains deferred with its existing
mode-transition and capture lifecycle requirements.
