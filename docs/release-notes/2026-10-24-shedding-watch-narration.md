## Retry storm narration

The added Shed load simulation now opens with a non-blocking “Watch …” card at 1.2 seconds,
pointing out the Payments queue, shed count and slowdown at 3 seconds. The four comparisons
shared with master retain master's narration entries verbatim. Shedding settings, arrivals and
outcomes are unchanged.

## Output parity

Nine retry-storm goldens change only to carry the updated opening text: agent/describe,
agent/edit, exports/drawio-meta, exports/drawio, exports/html (dark and light), exports/native,
sim/shed-load and skill/scripts. Export hashes and byte counts follow the text change;
the simulation golden changes only its note and marker text, preserving all outcomes.
The i18n/catalogs golden is regenerated to combine
master's tutorial messages with this branch's shedding messages after the master merge;
its message counts, fallback counts and tutorial hashes reflect that combined catalog.
