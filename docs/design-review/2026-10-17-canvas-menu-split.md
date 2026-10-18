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
| `placement/useCanvasEditCommands.ts`  |    New |                            177 |
| `placement/useQuickAddPlacement.ts`   |    New |                            149 |
| `placement/useConnectionPlacement.ts` |    New |                            113 |
| `placement/useDragPlacement.ts`       |    New |                            352 |
| `placement/useRailPlacement.ts`       |    New |                             93 |
| `menus/useCanvasMenus.ts`             |    New |                            133 |

The five-line `nodeKinds.ts` is removed; its shared guards live beside the flow types in `types.ts` (60 → 64 lines). Each new source file owns a separate concept and stays above the small-file cutoff. Existing box selection, settled selection, controls and document modules retain their boundaries.

## Composition overhead

The new placement and menu hooks pass their dependencies positionally and return destructured tuples. This removes the parameter bags introduced during extraction while retaining the original primitive hook arguments, callback bodies and order. Type checking and a source audit verify the positional mapping; no test assertion changes.

The canvas pair is about 0.3 kB gzip larger than this task's starting checkpoint (roughly 0.14%); the entry remains about 107 kB gzip. The earlier packaging added about 1 kB to that pair and was rejected. The first high-worker validation repeat passed 221 cases before the run was deliberately stopped to apply this refinement; final validation is rerun on the committed result.
