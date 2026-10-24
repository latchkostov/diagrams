## Tests wait for state

Replaced all 71 E2E `waitForTimeout` calls with completion signals, assertions, rendering opportunities,
or controlled Playwright clocks. History, autosave, smart-guide settlement and complete password-link
work expose read-only development/E2E probes; production builds reject any leaked probe.
Time-driven tests install their clocks before mounting the relevant UI. The Watch together
connection-loss test pauses host beacons and advances the guest through the actual silence threshold,
instead of starving a browser thread with a busy loop.
The typing comparison controls the idle handoff and paint boundary in each sample and finishes
autosave/history work between samples. Its exact render counts and real-worker assertions are unchanged;
each sample also asserts that edit debounces have not fired. The CPU benchmark keeps its real clock.

The simulation inspector's keyboard contract now waits for the independent identity surface and its pending
rename focus before exercising shell keyboard navigation. A held-identity regression covers the race.

Lint rejects new timed waits, including bracket and optional access. Its exception list is empty;
any future exception needs an exact location and a reason, and obsolete exceptions fail lint.
The scoped gate accepts `--repeat-each` for Playwright repetitions under Linux load.

No intended diagram, simulation or export output changes. No parity goldens were updated.
