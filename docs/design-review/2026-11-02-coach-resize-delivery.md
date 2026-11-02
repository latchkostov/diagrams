## Coach resize delivery review

The change removes repeated placement scans without adding controls or changing placement rules, lesson words, focus, or pointer and keyboard routes. Initial instructions still place synchronously. Mutations continue to measure before paint with the animation clock paused, including target changes that do not resize an observed root. Independent resize notifications are ignored only when their root rectangles match those read at the latest measurement; later changes remain observable.

A shared ResizeObserver alone would still leave the earlier mutation measurement duplicated at resize delivery. Deferring all placement to an animation frame would break paused-clock placement. Keeping the existing observers and comparing their rectangles addresses the delivery boundary within the tutorials module.
