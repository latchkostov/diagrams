## Exports omit lazy loading placeholders

SVG and PNG exports exclude pending and failed lazy surface shells, including edge
message tips and Live node/edge readouts. Exporting while these optional chunks are
held or unavailable completes without baking a loading placeholder into the file.
Output-bearing Live surfaces still use the existing readiness hook. Interactive
HTML exports continue to serialize the diagram model rather than the editor DOM.

All 3,358 parity goldens remain unchanged. The dark hand-shaped-lines image case
now holds the message-tip chunk while comparing SVG structure and PNG against its
existing goldens. The branch-to-datacentre goldens retain their loaded hover metadata.
A separate regression checks the intermediate PNG SVG for loading
elements and compares SVG, PNG and HTML bytes with an unhovered same-run baseline
(normalizing only the SVG library's random pseudo-element class names).
