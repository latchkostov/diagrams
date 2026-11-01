## Gesture completion

The driver must finish one native gesture before delivering the next keyboard command. A wheel that begins at an already reached boundary may produce no scroll event; a wheel that moves to that boundary still needs its real `scrollend`. The regression distinguishes these cases while retaining the original pointer, Home, End and paging assertions.

## UX review

No product scrolling, focus policy, animation, colour or chrome changes. No new control, timeout, tolerance, skip or quarantine. The held-event regression strengthens the driver's observation; the exact Home=0 requirement stays enabled. Local Windows and Linux success does not establish the separate macOS outcome, which remains subject to the dispatched Nightly.
