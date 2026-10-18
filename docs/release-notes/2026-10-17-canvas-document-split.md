## Canvas document extraction

Internal refactor with no user-visible change: CanvasView delegates initial document loading,
autosave, example promotion, conversation retention and its document handle to
`src/canvas/document/useCanvasDocument.ts`. The hooks remain at their original call sites,
with the same effect kinds, dependency arrays, timers and cleanup order. No output golden
changes are intended or recorded.
