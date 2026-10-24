## Security: bound untrusted imports and room state

Long imported labels skip the wrap search when they exceed the three-line display budget; their full text stays
available in the existing truncation and tooltip path. draw.io HTML labels use a forward scan, and pages exceeding
the shared 5,000-node limit are rejected before pairwise spacing calculations.

Room updates now have accumulated receive budgets: 32 MiB per authenticated sender and 64 MiB in total, including
pending Yjs state. Sender accounting is capped at the existing 64-sender limit. An update exceeding a budget is
refused before application with `peer-full`, `room-full` or `too-many-peers`; the session quarantines that sender
through its existing rejection path. Exact retained-state measurements and duplicate-update filtering reclaim
conservative charges, so normal editing, garbage collection, sync replies and recovery continue to work.

Hostile-input regressions use operation counts, with normal-input checks alongside them. Native regex backtracking
is opaque to those counters, so the HTML regression additionally forbids tag replacement regexes. Temporarily
restoring the original implementations produces seven expected regression failures covering all four findings.
No parity goldens are changed or re-recorded.
