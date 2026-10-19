## Viewer controls and recovery

Reused Interactive HTML's three viewport controls and keyboard behavior in the platform bundle.
Buttons retain accessible names, shortcut titles and visible keyboard focus. Fit accounts for the controls;
attribution stays in the opposite corner. The designer review caught the inherited embed attribution
placement sharing the new controls' corner; the bundle now uses the viewer's bottom-right placement.

Mounted the shared toast renderer so live actions announce errors and recovery actions using the
established toast stack. No top-bar controls or menu entries were added.

## Scope and review

Kept the existing vertical three-button arrangement during extraction. A horizontal redesign would
change established Interactive HTML output and belongs in a separate visual change. Rejected broader
CSP permissions: only blob images and media are needed. Kept the cached React tree rather than rebuilding
it on pageshow, preserving reader state and adapter subscriptions.

Designer-agent static review covered controls, placement and toast behavior. Browser regressions exercise
keyboard zoom/pan/fit under the host CSP, accessible errors and recording Undo.

## Verification

All 21 viewer/Interactive HTML browser cases pass. Removing the lifecycle, control and toast fixes makes
their regressions fail; removing the CSP/assets fixes fails the build contract. Removing the production-only
skip with its artifact absent fails on development. Restored code passes; development skips all eight bundle
cases. Output parity checks 2,530 goldens unchanged. The Linux load-repeat gate was attempted with eight
workers and CPUs, but exited 75 because the shared gate budget was busy; no capacity wait was queued.

The subsequent full Linux gate passed static checks, all 11,432 units and all 2,530 unchanged goldens,
but failed five main-editor browser cases. The three failing spec files passed twice on clean master
(110 passes), so the failures remain unconfirmed rather than being labelled pre-existing. Evidence and
follow-up are in `docs/backlog/2026-10-18-viewer-review-full-gate-load.md`. No full-suite rerun or assertion
relaxation was used.
