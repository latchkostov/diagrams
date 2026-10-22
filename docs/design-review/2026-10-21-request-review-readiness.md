## Request review: keep existing actions trustworthy

No controls or chrome were added. Checks keep their primary action and secondary alternatives. Pending
agent checks wait for a complete result, and unavailable checks report failure. Local fallback fixes use
the same findings store as worker fixes.

After an alternative removes multiple warnings, focus returns to a surviving finding after the refreshed
rows render, or to Close when none remain. Inspector findings retain their existing persistent body
fallback, since their entire findings group can disappear. Moving focus intentionally into the scaling
inspector keeps that focus.

## Decisions

Retained the existing timeout affordability formula and bundle limits. Corrected its response input
instead of adding another timeout formula. Rejected empty-cache success, duplicate findings caches,
unbudgeted replay preparation and weaker browser assertions.
