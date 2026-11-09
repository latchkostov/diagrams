## Responsive diagram imports

Format detection now scans XML comments once so an unrecognized import cannot freeze the editor.
Draw.io XML and embedded SVG exports continue to open normally, and invalid native format names
receive the existing compatibility error.

Manual benchmark and coverage comparisons now enforce read-only cache access for selected revisions,
and selected checkouts retain no Git credentials. The Confluence test proxy accepts only its configured
viewer origin and never follows redirects.

No output parity goldens are intentionally changed; diagram, simulation and export output is unchanged.
