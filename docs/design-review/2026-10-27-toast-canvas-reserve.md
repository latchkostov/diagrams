## Canvas first-view reserve: PR #340

Measured on Node 24.22.0 with the production bundle report (gzip level 9), before the trim at `393a2db9a` and against its merge-base `c59c2127f`:

| Build                   | Canvas first view, gzip |
| ----------------------- | ----------------------: |
| Merge-base              |                374707 B |
| PR before trim          |                377784 B |
| Trim                    |                373802 B |
| Unchanged reserve limit |                374808 B |

The PR added 3077 B over the merge-base. The trim removes 3982 B, leaving 1006 B below the reserve limit (and 9198 B below the download budget). The startup list remains examples, index, native, preload-helper, rolldown-runtime and shell-runtime.

## Module attribution

Every changed source module with a nonzero rendered-byte delta in the PR's startup/canvas closure is below. These are the bundle report's rendered module bytes, before chunk compression; gzip contributions are not independently additive because modules share a compression dictionary. The last column counts only modules still in the trimmed first view, so deferred renderer/store modules read zero.

| Module                                          | Merge-base | PR before | Delta | Trim first view |
| ----------------------------------------------- | ---------: | --------: | ----: | --------------: |
| `src/App.tsx`                                   |      25459 |     25490 |    31 |           25493 |
| `src/canvas/placement/useCanvasEditCommands.ts` |       4172 |      4250 |    78 |            4250 |
| `src/canvas/placement/useDragPlacement.ts`      |       9460 |      9539 |    79 |            9539 |
| `src/components/useDialogInteraction.ts`        |       3024 |      3212 |   188 |            3200 |
| `src/editor/history.ts`                         |       1406 |      1538 |   132 |            1538 |
| `src/editor/historyController.ts`               |       3949 |      4461 |   512 |            4461 |
| `src/editor/useEditor.ts`                       |      61318 |     61492 |   174 |           61492 |
| `src/editor/useHistory.ts`                      |       6237 |      7344 |  1107 |            7344 |
| `src/interop/ui/Dialog.tsx`                     |       2129 |      2353 |   224 |            2353 |
| `src/interop/ui/Toaster.tsx`                    |       4111 |      8994 |  4883 |               0 |
| `src/interop/ui/toast.ts`                       |       1785 |      8253 |  6468 |            2113 |
| `src/interop/ui/toastEngagement.ts`             |          0 |       823 |   823 |               0 |
| `src/interop/ui/toastStack.ts`                  |        570 |       730 |   160 |             570 |
| `src/lib/modalLayers.ts`                        |          0 |       904 |   904 |             616 |

## UX review

No controls or chrome are added. Notification ids and Undo ownership are captured synchronously. The first notification starts one shared renderer download; commands, progress, dismissal and history invalidation replay in order. Once loaded, the renderer stays mounted for the page's lifetime, preserving focus-return targets across notifications and modal handoffs. A renderer-download failure offers Retry outside the failed chunk. Existing dialogs retain the shared useDialogInteraction keyboard/inertness/focus boundary.

The held-chunk tests cover queued Undo, file and PNG export, cursor stability, palette focus return, download Retry and delayed feedback placement beside a dialog. They use input, geometry and request barriers, without elapsed-time assertions. Restoring the eager Toaster import deliberately fails both startup/canvas module guards.

## Decisions

The renderer, contact reducer, feedback placement and interaction store are deferred together. A small modal registry stays synchronous: dialogs must record ownership before their autofocus blurs a toast, including while the renderer is pending. The generic machine runtime remains used by existing startup controllers; toast engagement no longer depends on it. Already eager modules share the shell dictionary, while the independent example identity table stays acyclic in examples and thumbnail geometry shares the native model dictionary. No additional surface is deferred, no budget/reserve is raised, and no startup chunk pin is widened.

Toast rendering is infrastructure for the lazy-surface runtime's failure reporting. Its bootstrap therefore uses lazyComponent with recovery outside its downloaded renderer, rather than making notification recovery depend on defineLazySurface, which itself reports failures through notifications. The toast UI is excluded from visual exports, which must proceed while its chunk is held.

## Verification

- Selected unit tests: 198 passed across 13 files.
- Bundle split: 27 passed. The skill ZIP check passed its unchanged cap.
- Production build, entry/viewer/Forge size budgets and regeneration passed.
- Parity: 3,178 goldens, zero changed, added, missing or stale.
- The initial held-chunk browser run passed all three cases. The later PNG assertion awaits CI.
- The requested five-repeat Linux run for toast, dialog, palette and injection specs was attempted twice;
  both admissions exited 75 because another run held the entire shared worker budget. No lock was bypassed.
- The deliberately restored eager import failed both startup/canvas module assertions, then was restored.
