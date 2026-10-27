## Trim 3 final fix round: viewer bundle and recovery

The read-only HTML viewer excludes the editor-only stencil loading shell, annotation tiles and context menu. On the final sources synced with master, the skill ZIP falls from 835330 B to 820785 B (14545 B saved), with the 835000 B cap unchanged. The generated viewer is refreshed; every skill file remains included. The initial CI size was 835246 B; master changed the same-run baseline during this round.

| Exclusion                                            | Before ZIP B | After ZIP B | Saved B |
| ---------------------------------------------------- | -----------: | ----------: | ------: |
| Stencil-library loading shell                        |       835330 |      834340 |     990 |
| Annotation tiles and search initialization           |       834340 |      832719 |    1621 |
| Editing context menu and stencil-search dependencies |       832719 |      820785 |   11934 |

These are successive builds of the same final sources, restoring the original annotation module for the comparison and retaining all skill files.

Annotation search now loads with the stencil library. The canvas first view measures 370521 B and Live's additional closure 128571 B. Keep the exact third-trim ceiling, 383000 - 8192 - 4096 = 370712 B: the change trims real bytes instead of relaxing the additional 4096 B margin below the earlier 374808 B reserve. No download budget is raised.

## UX review and rejected alternatives

A phone's pinned library uses the desktop pinned-panel layer (5), below page notifications (7). Its failed-download Retry remains clickable, while flyouts and menus retain their own higher layers. No controls or text are added. Rejected a forced test click or a keyboard-only workaround because the pointer obstruction was a product bug.

The CI import trace shows Focus intentionally hiding out-of-frame imported nodes before the report opens. Initial Edit chooses Focus for large drawings under the existing UX rule. The whole-diagram import assertions now wait for initial camera settling, choose Overview and settle again. Every existing node, connection, report, chip and Undo assertion remains. Rejected changing import-report loading or weakening visibility assertions: the report itself had not failed.

## Verification

The two heavy files pass 203 tests. Reintroducing editor viewer modules fails the new exclusion regression; restoring eager annotation search fails the unchanged reserve check (370713 B against 370712 B). The four requested browser specs pass both Linux repeats at four workers and four CPUs: 148 passed, zero failed or flaky. An overlapping native second repeat was invalidated by the Linux build replacing the shared E2E output; the isolated Linux runs passed. Regeneration, i18n validation, skill freshness, production build and size checks pass. Restoring the old phone layer and forcing the import assertions into Focus both reproduce their respective browser failures; the fixes are restored. No parity goldens are changed or re-recorded; this fix round uses only the brief's targeted checks.
