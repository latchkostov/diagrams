## Canvas menu split review

Internal refactor: menu state, translated item factories and the pane, node, annotation, boundary, edge and selection context-menu handlers now live together in `src/canvas/menus/useCanvasMenus.ts`. The menu JSX and built-in action registration remain in CanvasView. The placement hooks import the menu state contract from the menu module.

No controls, chrome or interactions change. All 194 CanvasInner hook calls match the selection checkpoint, including every argument, callback body and dependency array (with the ref parameter alias normalized). The complete CanvasInner JSX also matches, including DOM structure, ARIA, classes, test ids and inline handlers. Camera events, effect kinds, frames and timers are unchanged. Tests retain their original assertions.

## File map and line counts

Counts compare the starting selection checkpoint `6e9b81bb` with the completed split. CanvasView was 2,641 lines before the document, chrome and selection extractions; the remaining file composes document state, camera, editor, interaction hooks and the existing view.

| File under `src/canvas/`              | Before |                          After |
| ------------------------------------- | -----: | -----------------------------: |
| `CanvasView.tsx`                      |   1835 |                           1154 |
| `document/useCanvasDocument.ts`       |    252 |                            252 |
| `chrome/CanvasControls.tsx`           |    133 |                            133 |
| `chrome/CanvasOverlays.tsx`           |    178 |                            204 |
| `chrome/useCanvasChrome.ts`           |     27 | Folded into the related module |
| `selection/useBoxSelection.ts`        |    117 |                            117 |
| `selection/useCanvasNavigation.ts`    |    378 |                            431 |
| `selection/usePanKeys.ts`             |     55 | Folded into the related module |
| `selection/useSettledSelection.ts`    |     98 |                             98 |
| `placement/useCanvasEditCommands.ts`  |    New |                            187 |
| `placement/useQuickAddPlacement.ts`   |    New |                            170 |
| `placement/useConnectionPlacement.ts` |    New |                            123 |
| `placement/useDragPlacement.ts`       |    New |                            370 |
| `placement/useRailPlacement.ts`       |    New |                            102 |
| `menus/useCanvasMenus.ts`             |    New |                            143 |

The five-line `nodeKinds.ts` is removed; its shared guards live beside the flow types in `types.ts` (60 → 64 lines). No new source file is below 100 lines. Existing box selection, settled selection, controls and document modules retain their boundaries.
