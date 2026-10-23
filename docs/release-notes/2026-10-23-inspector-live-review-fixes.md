## Inspector Live review fixes

Connection renames typed while Properties downloads are held and applied when Label arrives, including Enter and Esc.
Retry keeps keyboard focus in the Label field, even when Properties opened without a rename request.
Node and connection readouts share the running simulation's connection overrides and cache compiled
topology by diagram identity rather than rebuilding it for live counter publications.

Live uses the Inspector's section-heading style, tighter spacing and a full-width throughput strip.
Flat series draw at mid-height above a visible baseline; Last 10 seconds and the current/low/peak values
sit below the chart. Live owns observed counters, leaving Throughput explained's configured estimate
and More. Threads and calls use two-column facts, with the existing ceiling explanation retained.

Regression coverage holds connection downloads during naming and keyboard Retry, compares running
wait overrides with hover, actually collapses Live during scaling announcements, and checks exact
nonzero request Goodput, the corresponding chart sample and the ten-sample history bound.

The only intended parity change is `node/i18n/catalogs.json`: five new English messages for docked
thread/call facts and the retry-policy sentence, plus their catalog hash and fallback counts.
Simulation, export, layout and image goldens are unchanged.
