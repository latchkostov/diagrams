## Skill full layout resets shaped routes

The agent skill now clears edge waypoints when forced layout or missing node coordinates trigger a
full layout, matching the app. Attachment sides and other authored edge fields survive, and diagrams
that need no layout retain their shaped routes. The input document is not mutated.

No parity goldens were changed in this targeted PR #283 fix round.
