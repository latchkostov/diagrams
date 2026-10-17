## Live view on large diagrams: what perf 5 left (2026-10-17)

- **`readMarch` and `querySelector` on every publish.** Across the panel's close click at 5,000 nodes and Traffic × 10,
  the hot JavaScript was `querySelector` (22.5%), `readMarch` (7.6%), `getBoundingClientRect`, `getPointAtLength` and
  `getTotalLength`: hotspot 6 in docs/BENCHMARKS.md. The decorator also queries every node and edge wrapper per publish
  (`src/live/decorations.ts`). Native layer work dominated the frame (Layerize 8.8 s of a 10 s trace against under 1 s
  of script, style, layout and paint together), so this was not where the 3 s frames came from, and it isn't fixed
  here. Next step: cache the wrapper lists per React Flow render, and read march geometry only for edges whose route
  changed.
- **Why the node heat pulse ends the slow phase.** In the earlier ablations, turning off `lv-heat-pulse` made the slow
  phase last the whole run (0.31 fps at 77 s). The likely reason is that Chrome merges layers differently once many
  nodes animate a filter. This is inferred, not verified. With the fades dropped on large diagrams the slow phase no
  longer depends on it, but a trace with `LayerTree` snapshots before and after the first pulses would confirm it.
