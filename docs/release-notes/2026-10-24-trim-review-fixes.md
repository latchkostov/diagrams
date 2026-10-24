## PR #272: preserve cold-menu navigation and parallel Inputs loading

Searchable menus retain the query, navigation, later edits and Enter in order while their rows
download. A cold quick-add now chooses the same stencil as an already loaded menu. Queries with
no navigation still support immediate Enter. Inputs downloads its panel alongside capacity analysis,
retaining its loading shell and original keyboard opener.

Held-chunk regressions compare cold and loaded quick-add, including edits after navigation, and
assert that the Inputs panel request starts before analysis is released. All three fail on d5710691.
The capacity export regression now inspects the downloaded SVG for the caller's healthy ring,
healthy label and resolved `100/s of 20k/s` capacity text.

Production gzip measurements: canvas first view 374,652 B (8,348 B headroom against 383,000 B),
Live session 126,242 B (8,758 B headroom against 135,000 B), entry 107,938 B.
The menu deferral remains; reverting it was unnecessary and would consume the required headroom.
No output changes are intended and no parity goldens were changed. This fix round runs only the
two targeted browser specs and static checks; full-suite and parity validation remain with CI.
