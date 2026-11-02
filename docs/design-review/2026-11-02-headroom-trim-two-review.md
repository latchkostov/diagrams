## Headroom trim two review: loading and read-only parity

No controls or wording are added; the chrome budget is unchanged. Opening settings in Edit loads the
existing settings surface and its small formatter, preserving the independent Live download boundary.
The new bundle assertion fails when the formatter is put back into LiveSession.

The viewer's camera now receives the editor's recursive boundary expansion, including nested boundaries
and member annotations. This restores the editor's framing rule without introducing another camera policy.
Outer, inner and overlapping boundary selections are compared against the real editor port and explicit
expected IDs. Reverting the viewer to its old expansion fails both boundary cases.

Read-only API audit against useEditor and its CanvasView callers:

- `getDiagram`, `getNode`, `getEdge`, `getGroup` and `getAnnotation` use the same flow-to-file conversion
  and lookup semantics, including missing IDs. Keyboard navigation uses these getters and selection.
- `getSelection`, `select` and `clearSelection` preserve node/annotation, boundary and edge selection;
  selecting does not edit the file or its version.
- `fitView`, `zoomTo100` and `zoomToSelection` forward the same camera calls. Selection takes precedence
  over hover, edge-only selections retain their edges, and an empty selection without hover returns false.
- `prefs`, `setPref` and `isPrivate` read the latest dependencies and callbacks. The hook regression
  rerenders changed controlled nodes, edges, metadata, preferences, privacy and camera/setter callbacks,
  checks API identity, then rerenders again to check the new hover callback. A mount-only dependency refresh
  fails the test.
- `getDocumentVersion` stays stable for the viewer's single immutable document and transient selection.
  ViewerApp mounts one decoded file; the canvas handle exposes reads, not document replacement to its UI.
- `canUndo`, `canRedo` and `hasClipboard` intentionally remain false. The viewer has no history, clipboard
  commands or document mutations. Editing shortcuts, palette registration and inspector commands are gated
  off by readOnly; LiveSession receives no editing API. The document handle's title setter is not called by
  the viewer. No additional reachable API mismatch was found.

Optional panels, readiness notifications, export waits, failure recovery and CSS ordering retain their
existing paths. No new lazy surface or showcase is introduced. The full editor implementation was kept out
of the viewer because restoring it would undo the ZIP reduction.
