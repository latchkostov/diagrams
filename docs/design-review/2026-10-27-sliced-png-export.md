## Sliced PNG export (2026-10-27)

Reviewed the export changes against the UX principles through source and regression-test inspection.
No chrome, settings or terminology changes are needed. Existing File and Image actions retain one
primary export action, with focused Cancel and Escape while work runs.

PNG raster progress now advances between strips and remains unfinished during encoding. Cancellation
and document-change errors retain the existing cleanup and retry behavior; export creates no Undo
step. SVG and Interactive HTML keep their existing output paths.

No blocking UX findings. Report measured longest-frame improvements without implying that every
browser-controlled task is imperceptible. This review did not include a visual browser walkthrough.
