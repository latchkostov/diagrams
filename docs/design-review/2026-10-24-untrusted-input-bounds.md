## Untrusted-input bounds UX review

No controls or chrome are added. Ordinary wrapping, draw.io HTML breaks, import spacing, collaborative edits,
duplicate sync replies and checkpoint recovery retain their existing behavior. Long labels keep their full text
through the existing truncation and tooltip path. Oversized draw.io pages fail with a node-budget error before
expensive placement work. Room resource refusals use the existing counted rejection and sender quarantine path;
honest editors can continue making edits after a hostile sender is quarantined.

Rejected alternatives: truncating the stored label would lose user data; rejecting lifetime traffic without
reclaiming duplicate and collected state would penalize normal rooms; checking the node limit only after scaling
would leave the expensive work reachable. Output parity must retain the committed goldens unchanged.
