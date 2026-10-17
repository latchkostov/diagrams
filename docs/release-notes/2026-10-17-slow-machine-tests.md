## Reliable tests on small machines

The portable gate accepts Linux container CPU and memory caps: `pnpm gate full --linux --cpus 3 --memory 7g --ports 6600`.
Auto workers respect those limits. Playwright uses no retries in PR CI as well as the local gate and Nightly.

The AI dock waits for its canvas before offering inputs and preserves active dictation across a temporary host detach. An open menu now cancels stale hover work when its language changes, keeping RTL submenus beside their parent.
Room recovery also persists edits arriving just as the previous storage write finishes, and waits for that
revision before reporting the flush complete.

Browser tests wait for the controls and layout they use. Simulation assertions advance a controlled clock;
frame measurements count frames. Nudge assertions use diagram coordinates across camera changes,
and resize tests target the visible handle after the Inspector settles. Offline HTML checks keep one animation-clock origin, including encrypted files. Input validation pauses playback while testing deliberately extreme rates,
and cloud-save races hold the operation until the tested edit is complete. Longer multi-view tests use the
existing slow-test annotation instead of machine-dependent timeout calibration.

The resource invariant Nightly now splits its 5,000 A1 and 5,000 A3 seeds across four independent jobs.
A3 doubled the seed count and introduced longer controller scenarios after the previous four-minute run.
Coverage, internal simulation steps and the ten-minute job backstop are retained.

No output golden is intentionally changed. The detailed failure classification and verification are in
[the review](../design-review/2026-10-17-slow-machine-tests.md).
