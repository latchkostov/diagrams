## PNG review

Reviewed all 18 final-2 production captures, in both themes at the original desktop and phone sizes. The Requests row now reserves canvas space and ends with the visible React Flow credit. Cards no longer leave unlabelled slivers at the rail, dock or caption. Pins avoid cards, with route ends attached to them; unretained labels and arrows disappear at the frame fade.

The large Overview preserves stronger silhouettes and connections without tiny icon tiles, oversized live counters or blank note rectangles. Dark boundary fills no longer dominate the canvas. Phone Follow shows an incoming stream and timeout cue, and expanded narration has a rounded card cutout without the old rectangular apron or an off-frame Orders badge. Navigation has 44 px targets.

The inspector's unavailable-throughput note is inset and glyph-led, the Description hint wraps, the attention chevron fits, and scrolled content starts at a section boundary. The zoom strip loses its stray separator; the active mode follows a single selected subset. Check markers sit within cards with an 8 px gap and connector warnings clear the corner. No controls were added.

## Decisions

Retained actual loss semantics after inspecting runtime counters: Checkout's 1.7k is lost, while the dock's processed figure belongs to Payments. Red badges now spell out Lost and actual processed counts remain neutral. Did not relabel terminal losses as processed. Kept React Flow attribution visible at the end of the legend row. Kept budgets and assertions fixed. Removed an early camera-policy change that also cropped multi-selection layouts; the final mode readout derives the single-selection subset without changing multi-selection camera ownership.

## Evidence

`C:/Users/latch/bin/codex-tasks/redesign-2026-10/build/final-2/report.json` contains PNG-derived contrasts and measured bounds. Desktop loss ink is 7.18:1 in both themes; kept ink is 15.30:1 / 13.02:1. The unavailable note is 5.30:1 / 6.43:1 and narration time is 5.78:1 / 6.78:1. The affected browser tests continue to require 3:1 principal strokes and 4.5:1 text.

## Neighbour regression review

Kept editable annotations visible and restricted blank-note removal to Live Overview. Single-selection Focus readout applies to diagram nodes in Edit. Narrow desktop canvases retain 28 px frame padding; the phone uses its explicit 8 px side inset. Dock drag observation excludes the column that the drag itself resizes, preventing a resize notification from cancelling pointer capture. The existing resize regressions now use the documented Workbench width while keeping their original minimum final widths. Its active-drag unit regression fails when column observation is restored.

The fit also respects mirrored dock/rail placement: only a surface that actually overlaps the measured canvas can reduce it. Arabic, English and pseudo-locale routing-header checks pass without weakening their fit assertion; restoring the former left/right assumptions fails the RTL rectangle regression.
