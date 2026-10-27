## Zone label movement review

The existing boundary focus controls keep their names, size, padding and action.
Their anchors now belong to the drawing, so panning and wheel zoom cannot detach
them from their boundaries. No controls or chrome were added. The titles stay
readable through zoom reversals, and the viewport clips them at the canvas edge.

The narration callout subscribes to viewport transforms. Edge-label pills and Live
badges already render in flow space. Offscreen navigation pins belong to the frame;
the Overview selection hint intentionally stays at the top of the screen. These
screen controls retain their existing behavior. Capture excludes the new portal
layer just as it excluded the previous overlay.

Review found and corrected portal labels wrapping into multiple lines, retained the
existing focus-button test selector contract, and excluded the portalled buttons
from canvas pan and node-drag gestures.

## Choices

Rejected per-frame screen-space measurement and full decoration updates: flow-space
anchors provide pan tracking without DOM reads, layout work or React commits. Zoom
uses only local paint transforms and preserves the identity layer's fitting behavior.
