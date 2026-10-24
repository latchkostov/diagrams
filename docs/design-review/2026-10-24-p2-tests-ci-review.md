## P2 tests/CI and review tooling UX review

The batch adds no controls, UI copy, menus or layout. The room chip and waiting view keep their existing wording and actions while subscribing to the same immutable diagnostic state, so late presence and recovery cannot leave diagnostic attributes behind the session. Existing focus handoff behavior remains intact.

The quick-add regression still types the new name immediately after Enter and requires the exact name. Readiness checks only establish that the preceding stencil query reached its focused search field. The bootstrap-fit regression establishes that the canvas is mounted before delivering its viewport command, preserves the held-measurement scenario, and requires the chosen viewport to survive measurement release. Neither test relaxes the product contract or adds a delay budget.

Rejected: waiting for inspector focus before typing (would stop covering immediate naming), increasing timeouts, weakening pool/percentile assertions, changing simulation implementation, recording output goldens to mask differences, or retaining flake exemptions after the required 10 green repetitions.
