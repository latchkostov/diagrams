## Keep the user's place

Reviewed Edit to Live on desktop and phone: Live keeps the exact viewport rather than replacing a
close-up with Overview. An empty view gets one recovery fit. Following only reveals a narrated subject
that is outside the exposed canvas, retaining zoom and respecting the phone's readable floor. A note
ending leaves the camera in place. Overview and Focus remain available in their existing controls.
Visibility includes connection strokes and labels. Fixed-zoom interpolation prevents a long pan from
briefly zooming out between its endpoints; a visible subject near the pane edge stays put.

## Give titles room

Boundary and zone titles have a reserved band above the region. Screen-sized title ink avoids cards,
routes and earlier titles, so nested boundaries do not consume their first row of content. Narrow
regions allow the label to extend beside the top edge while keeping its words readable. Pan anchors
remain attached during every frame; zoom chooses a free place in the band as the available space changes.

The regression audit covers cards and connection strokes in black-friday-commerce,
recommendations-feature-store and delivery-dispatch at fit and 35%, in Edit and Live.

## Scope decisions

No camera preference or extra control is needed: retaining the user's camera is the default. Moving
authored cards or growing boundaries to repair presentation would change the drawing and its exports,
so the title band belongs to screen presentation. The general zoomed-out treatment stays as it is for
the planned designer pass. Existing public examples demonstrate both changes without adding a new
simulation or stencil.
