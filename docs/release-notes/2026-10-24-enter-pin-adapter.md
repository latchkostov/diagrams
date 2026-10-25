## Enter-to-pin compatibility (#293)

Restore the keyboard adapter's compatibility with readouts that expose state and pin/close actions without the newer visibility and eligibility queries. Enter still pins an unpinned focused summary or a newly hovered summary, while pinned cards and controls inside cards keep their own Enter. The full readout layer continues to reject hidden or unreadable targets.

The existing keyboard and NodeBadges tests are unchanged. No parity goldens changed; this fix round runs only the requested targeted specs.
