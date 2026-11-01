## Cause

Nightly 41271786390 on Windows reaches the recording flow's exact 0:01 assertion after the real clock already says 0:03; continued polling sees 0:07. The assertion's four-second backstop cannot recover a one-second value that has passed. This case used wall time while the neighbouring exact-duration recorder case already uses a controlled clock.

The fixture now installs and pauses its clock, keeps the original visible countdown/share checks, observes the intermediate countdown values, and advances frames until the actual fake encoder reports started. Only then does it drive exactly one recorded second. The original 0:01 assertion and timeouts remain unchanged. A frozen-clock invariant covers the intervening framing, MIME, presentation and chrome checks; the encoder's existing asynchronous stop is released explicitly before review. Every original review, metadata, preview, download and filename assertion remains.

## Verification

Three constrained native Windows executions pass. Restoring the original wall-clock flow while retaining the frozen-clock invariant makes the regression fail. The first negative-check script stopped on Windows' default text encoding before it could run; the file was restored and the successful negative uses explicit UTF-8 with byte-exact restoration.

The full recording spec runs twice in the pinned Linux container. This is test-only: application source remains the freshly checked font scheduling repair, with build, size, all 30 startup/reserve heavy cases, 31 renderer/protocol units and all 3,178 unchanged parity goldens passing. No deadline, tolerance, budget, skip, quarantine or golden changes. PR #411 records the final signed SHA and dispatched native inventories.
