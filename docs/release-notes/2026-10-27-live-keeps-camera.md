## Live keeps your camera

Entering Live preserves your current zoom and position, including on a phone. If the entire drawing is
off-screen, Live fits it once. Overview and Focus remain explicit choices. Following a narration only
reveals an off-screen subject, panning at the current zoom; phones retain their readable zoom floor.
Ending a note no longer fits the whole drawing.

Even a long narration pan keeps its zoom fixed throughout the animation. A visible connection or
connection label counts as keeping the drawing in view, and a fully visible subject near the pane edge
does not trigger a narration pan.

## Titles have their own band

Boundary and zone titles sit above their regions, at a readable screen size. Their reserved band avoids
cards, connection paths and other titles, including nested boundaries and narrow regions. No cards move
and the rest of the zoomed-out presentation is unchanged.

Image capture restores authored geometry, and every export golden is unchanged. The only changed
golden is `browser/layout/ev-charging-network.json`: after Auto-layout, the zone title
“OT sites · outbound-only” is now readable instead of hidden (`autoLayout.nodes["zone-ot"].text`
changes from empty to those words). Card geometry, routes, the Tidy result and all other goldens stay
unchanged.
