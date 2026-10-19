## Keyboard reading regions

Arrow keys continue to scroll the focused latency readout without panning the
diagram. Their small scroll steps now complete immediately, consistently with
Home, End and paging. Home must leave the readout exactly at the top even when it
immediately follows an arrow key. Modified shortcuts keep their existing behavior.
Wheel scrolling and focus order keep their existing behavior. No controls or copy
are added, so the chrome budget is unchanged.

## Fault styles

The style test waits for the existing idle fade to finish before saving its
baseline. The user-facing transition, cut styling and restoration stay intact.
Removing the fade or accepting approximate opacity would hide the race and weaken
the visual contract; neither is needed.
