## Reservation review fixes

Reviewed against the UX principles: recovery and retry accounting now keep Live occupancy and capacity aligned without adding controls, copy, settings or interaction changes. A down service continues to report logical failures and propagate failed replies even when its configured capacity is zero. Exact shrink assertions protect the existing visible held-reservation contract. No new feature or showcase is needed for these engine corrections.
