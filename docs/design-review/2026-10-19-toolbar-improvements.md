## Toolbar improvements review (PR #192)

Credit: @hfmm99 introduced the collapsible controls, dividers and Fit view flyout.

Keep the existing vertical toolbar and disclose the two extra zoom actions in its flyout. The split
Fit row reserves 30 px for Fit and 24 px for the menu, both 30 px high; the expanded toolbar is 54 px
wide so targets never overlap. Other controls use that width consistently. Collapse returns it to
30 px and leaves only Expand available. Built-in zoom controls unmount while collapsed; the rest
share an inert boundary. The regression checks actual focus, Tab in both directions, Enter and
restored zoom, not just a CSS class. Reload intentionally restores the expanded toolbar.

The interaction controller owns the exclusive menu, readiness, dismissal reasons and Escape focus
restoration. The editor's existing camera commands remain the only path for the two flyout actions.
Fit dismisses the flyout, and the trigger toggles it. Existing shortcuts and their translated sheet
labels are retained and covered, with no collision in liveKeys.

Rejected a 12 px corner target over Fit, transparent focusable tools, an independent flyout state,
a new persistent preference and a special fit inset that ignores the toolbar's real footprint.
Those choices cause accidental fits, invisible keyboard stops, competing menu ownership or hidden
content. The parity changes intentionally affect only the fitted view, never diagram geometry.
