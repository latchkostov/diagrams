## Scope

Test infrastructure only: no new controls, UI copy or interaction policy. Existing keyboard, geometry,
privacy, playback and cancellation assertions retain their intent. The lazy-inspector setup waits for
rename focus to settle before moving focus to the shell, preserving the real focus contract.

## Decisions

Use the existing camera, interaction, slow-motion, lazy-surface and checks signals. Add read-only E2E
completion probes where a negative assertion otherwise sees only the old saved document or unfinished
work. Advance actual time-driven behavior with Playwright's clock; count rendering opportunities when
checking that a paused view remains unchanged. Keep the timed-wait exception list empty.

The typing check controls its paint boundary and lets edit timers settle outside the
sample. This keeps asynchronous worker completion from admitting background saves or history commits
into just one mode. The CPU benchmark still measures its original real-time paint boundary.
