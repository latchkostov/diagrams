## Phone overflow and zoom integration review

Live keeps its read-only canvas gestures: a click selects a card, a drag pans, and connection dots
cannot edit the diagram. Edit retains its move affordance. The lazy overflow lifecycle must preserve
these mode-specific cursors through loading, failure and Retry.

The regression keeps every existing 44 px target, on-screen transport bounds and exact stable bounds
check. It adds a real node-originated pan and unchanged-document checks while the chunk is held.
There is no new chrome, control, layout or visual output; no CSS override is needed for the pointer
cursor produced by the correctly disabled editing gestures.
