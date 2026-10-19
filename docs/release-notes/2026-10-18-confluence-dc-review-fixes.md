## Confluence Data Center embed review fixes

Play diagram now selects the first saved simulation for attachment and inline sources using the
viewer's validated loaded-event metadata. Loading remains still until the reader clicks Play.
Frames and Play actions use the diagram title as their accessible name, with Untitled diagram
as the fallback. Off-screen macros defer viewer creation until they intersect the viewport and
reserve their complete footprint. Inline JSON reaches the viewer's size guard before parsing.

No output parity goldens change: these fixes affect only the Confluence macro wrapper, leaving
diagram rendering, simulation, exports and translations unchanged.
