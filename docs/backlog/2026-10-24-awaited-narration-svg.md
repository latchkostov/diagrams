## Awaited narration is absent from SVG export (LL-04)

The Batch 2 content regression fails on the unchanged product: hold `NoteCallout`, start SVG
export while `live.note` is active/loading, release it, and inspect the downloaded SVG. Readiness
settles and the download succeeds, but neither `live-note-text` nor the narration text is present.
`LiveSession` renders narration outside the viewport cloned by image export.

`tests/e2e/lazy-surfaces.spec.ts` retains the failing contract as
`test.fixme("live.note: exported SVG includes awaited narration")`. The original generated
readiness test remains enabled. The real tab recording regression captures this same narration
successfully. The initial focused run had 12 passes and this one assertion failure.

Follow up in the output/rendering lane: include active narration in SVG output, decide its exported
placement, enable the fixme, and review any intentional parity changes. Product changes were
outside the tests-only Batch 2 scope; no goldens were updated to hide the failure.
