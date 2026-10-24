## PR #281: quarantine segment tracking

The conservative reset avoids silently moving a different leg after overlapping routes or pointer
shaping. The edge remains selected and focused, existing handles remain available, and the live
announcement explains the reset. Cycling restarts predictably from either end. Simple keyboard
nudges retain their selection, with geometry read from the current route.

No controls or chrome were added. Geometric tracking was rejected because it cannot provide stable
identity through normalization and rerouting; the follow-up requires explicit identities.
