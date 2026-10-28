## Following between notes and on phones

Following a shared run continues to pan to the next narrated subject after a focused note expires.
Expiry clears pending movement while preserving the explicitly selected Following camera owner.
At high zoom, a followed or narrated card wider than the available phone frame stays painted,
including its Live readouts, wherever it intersects the exposed canvas. Following keeps the current zoom.

Both regressions fail with their respective fixes reverted. No parity goldens changed in this fix round.
Title placement also skips diagrams without regions, preserving the existing single-traversal check.
