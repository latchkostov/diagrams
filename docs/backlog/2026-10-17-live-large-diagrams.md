## Live view on large diagrams: what perf 5 left (2026-10-17)

- **`readMarch` and `querySelector` on every publish.** Across the panel's close click at 5,000 nodes and Traffic × 10,
  the hot JavaScript was `querySelector` (22.5%), `readMarch` (7.6%), `getBoundingClientRect`, `getPointAtLength` and
  `getTotalLength`: hotspot 6 in docs/BENCHMARKS.md. The decorator also queries every node and edge wrapper per publish
  (`src/live/decorations.ts`). Native layer work dominated the frame (Layerize 8.8 s of a 10 s trace against under 1 s
  of script, style, layout and paint together), so this was not where the 3 s frames came from, and it isn't fixed
  here. Next step: cache the wrapper lists per React Flow render, and read march geometry only for edges whose route
  changed.
- **Why the node heat pulses help.** In the earlier ablations, turning off `lv-heat-pulse` made the slow phase last the
  whole run (0.31 fps at 77 s). Perf 5 measured the same direction with the fades already gone: holding the pulse
  still on large diagrams (its brightest frame, no animation) cut the layers at Traffic × 10 on 5,000 nodes from about
  5,000 to 970 but doubled the steady frame (557 to about 1,000 ms at 2×), so it was dropped. The likely reason: each
  pulsing node gets a compositor layer of its own, so its large blurred shadow is rastered once and only composited
  afterwards, where a static one is repainted with everything around it. Not verified; a trace comparing raster time
  with and without the pulses would settle it, and might show a cheaper glow (a pre-rendered shadow, `will-change` on
  the heated cards) that keeps the gain without hundreds of animations.
