## Inspector Live design review, round two

Applied all five polish findings: a full-width visible flat-series line and baseline with a quiet
footer and visible time scope; observed counters owned by Live; the standard section-heading weight
with status on the right; one eight-pixel spacing rhythm; and shared docked label/value facts for
threads, ceiling and calls. The ceiling sentence remains shared with the hover. Failing is not
repeated in the retry-policy sentence.

The designer review identified inherited gaps stacking with padding and SVG aspect-ratio letterboxing;
both were corrected. No controls were added to the top bar or Live bar. Extra colours, separate
readout implementations and bundle-budget increases were rejected because shared components and
existing tokens cover this surface. Download recovery stays outside the deferred connection panel.
After syncing #248, renames use the interaction controller's held-key behavior, including abandoning
the name on download failure or a focus move. An eager Label was rejected to preserve those rules.

Before/after review covers the retry-storm and webhook-ingestion public examples, light and dark,
1280 and 1920 pixels, Inspector and pinned hover. Local captures are in
`C:\Users\latch\bin\codex-tasks\live-details-polish\{before2,after2}-*.png`.
