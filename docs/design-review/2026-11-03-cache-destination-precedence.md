## Cache destination precedence review

This correction keeps the existing Live readout and adds no controls. Configured destination names
now come from traffic classes actually won by each cache rule, using the runtime lookup rather
than independent per-rule matching. Exact and trailing-wildcard message predicates are sampled by
equivalence class and checked with the existing type matcher. Addressed and unaddressed traffic
both respect connection filters. Unresolved destinations keep the neutral aggregate description;
the counts remain per rule rather than claiming per-destination delivery totals.

The named asset/API regression and the message-type cases fail with the original helper and pass
with the fix. Existing Black Friday and Live publication indexing regressions remain intact.
