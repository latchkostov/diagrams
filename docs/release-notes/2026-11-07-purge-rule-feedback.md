## Missing purge rules explain blocked actions

Saved simulations with a removed cache rule now show a visible explanation naming the rule and
Timeline step, even while Timeline is collapsed. The explanation opens Timeline and focuses the
rule picker; Timeline also shows its warning marker. Run and Save retain a meaningful accessible
description until the rule is repaired.

The held-chip SVG regression now checks download completion and the exported boundary's grayscale,
dashed outline and cut link's stroke and dash pattern.

Only `node/i18n/catalogs.json` changes: the new repair message increases each catalog's message
count and updates its cache-area hash. The 37 translated catalogs gain one English fallback;
the pseudo-locale renders the new message without a fallback. Other targeted i18n goldens are unchanged.
