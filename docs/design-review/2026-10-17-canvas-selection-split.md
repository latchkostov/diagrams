## Canvas selection and keyboard extraction review

Selection, keyboard order, focus, announcements and pointer-up Inspector settling retain
the existing behavior. No controls, DOM, ARIA, test ids or styling change. The camera's
hold/release and navigation reveal remain the existing controller events; no viewport
writer or new scheduling was introduced.

## Verification blocker

The required Linux stress run found a Live trace footer intercepting an edge-label
right-click. The same unchanged test failed three times in 50 repetitions on each of two clean
master tips, including the newly landed PR #151. Selection remains unpushed under the standing stop rule; placement and
menus are deferred. Reproduction and continuation details are in
[the backlog fragment](../backlog/2026-10-17-canvas-split-continuation.md).
