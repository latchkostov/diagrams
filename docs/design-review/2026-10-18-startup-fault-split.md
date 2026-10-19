## Startup fault split

The first view no longer downloads fault execution or cached outage lookup. The existing Live
session loads them together, keeping the same loading surface, controls, keyboard behaviour,
fault labels and run results. Native fault grammar and target validation remain available when
opening a file. No chrome is added, and the canvas retains its two-chunk loading contract.

Rejected raising the budget or delaying file validation: the former hides the regression and
the latter adds a round trip to every diagram open. Fault wording and run results already load
behind Live; the shared grammar/runtime module was the eager dependency.
