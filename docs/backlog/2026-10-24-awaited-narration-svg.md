## DECIDED: SVG exports omit Live narration (LL-04, 2026-10-25)

Owner decision: recordings capture narration; SVG exports do not. Narration stays outside the
exported viewport. No rendering or placement change is needed.

The parked assertion is replaced with an enabled regression in
`tests/e2e/lazy-surfaces.spec.ts`: hold the active narration chunk, start SVG export, release it,
confirm narration is visible on the page, and assert its marker and text are absent from SVG.
The image export dialog and `docs/INTEROP.md` explain the format distinction. Existing recording
coverage retains narration in video.
