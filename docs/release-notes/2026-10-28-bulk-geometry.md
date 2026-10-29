## Bulk geometry survey comparisons

The Compare browser benchmarks workflow can run the opt-in survey's Auto-layout and Paste cases
for 500 and 1,500 parts. Selecting `survey2` in its title filter enables the helper and prepares both
sizes. It retains both revisions' raw samples and reports median/range action times, requiring at
least three finite unprofiled observations per action and size. Other filters keep their existing
comparison path. Use full commit SHAs for base and head.
Use the complete title filter `survey2 (layout|paste) pipeline@(500|1500)$`: the report requires
all four groups so incomplete runs cannot silently supply an acceptance result.

## Product outcome

The geometry-preparation prototype missed the requested greater-than-10% improvement. At 1,500
parts, the controlled comparison improved layout by 2.3% and regressed paste by 2.1%. No product
optimization is retained. The evidence, rejected approaches and next bounded investigation are in
[the blocker report](../backlog/2026-10-28-bulk-geometry-preparation-blocker.md). No output golden,
budget, reserve or assertion changed.
