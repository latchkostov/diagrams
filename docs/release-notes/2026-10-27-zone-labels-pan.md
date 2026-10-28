## Zone and boundary labels follow the canvas

Boundary focus titles now move with their outlines throughout a pan in Edit and Live,
including wheel zoom while a drag is held. Their flow-space anchors inherit React
Flow's viewport transform. Zoom changes only the titles' paint transforms, keeping
their text and padding readable without measuring or rerendering labels on pan frames.

The old screen-space overlay waited for the camera to settle before updating title
positions. The regression samples every boundary title before pointer-up and catches
the old behavior on the first drag step (18 px of drift against a 2 px tolerance).

No export goldens changed: all 3,045 Node and 133 browser goldens match. The portal
layer is explicitly excluded from image capture. Authored boundary and annotation
labels and all exported geometry stay unchanged.
