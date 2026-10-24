## Shaped lines interop and agents UX review

Reviewed against UX-PRINCIPLES with an independent designer review. No controls are added: people keep
using the existing draw.io export/import and agent tools. Our exported routes survive a round trip;
foreign routes use automatic routing with one counted report line, avoiding a silent loss of geometry.
Mermaid's geometry limitation is documented without adding a warning to a format that cannot carry it.

Agent descriptions expose fixed sides, using auto for an unfixed end, and mark shaped routes with a
bend count. Side changes preserve bends; route reset is explicit. Agents cannot supply bend coordinates.
The review caught side/waypoint guidance under Nodes; it now lives under Edges. It also identified
that full agent layout retained bends; the implementation and a regression now enforce the approved
reset rule while retaining fixed sides. Existing canvas controls and interaction behavior are untouched.
