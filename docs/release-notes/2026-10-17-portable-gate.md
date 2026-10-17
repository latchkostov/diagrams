## Portable gate and native browser reliability (2026-10-17)

- `pnpm gate` provides cross-platform diagnostics, repo-local setup, targeted checks
  and full production verification across chromium, dev, subpath, internal and locked.
  Full runs queue across worktrees and stamp only an unchanged clean commit; browser
  temporary profiles live on the repo drive. `--linux` uses the pinned Playwright image.
  Workers reserve 4 GiB, allow 2.5 GiB per worker and use at most three quarters
  of logical CPUs, capped at 12. More workers measured slower on a 32-thread host;
  a container's memory limit lowers the count to prevent trace-write exhaustion.
  Archive transport measured faster than a host bind mount, so full Linux runs use
  committed archives and native volumes for profiles and reports.
- Native tests use the platform's primary modifier for text editing, Undo and paste;
  Ctrl+wheel still models a real trackpad pinch on every OS. Nightly adds native
  Windows and macOS unit/E2E jobs with zero retries.
- Rapid RTL quick-add keeps its menu beside the landing outline when the Inspector
  opens. Shift+2 keeps its zoom when a deferred Inspector pan arrives. Highlighted menu hints use stronger ink, remaining above AA after display-RGB
  compositing. The editor adds no controls; UX review covers the deferred reveal at
  1280px in English and Arabic, and retains physical diagram placement.
- Export/import waits for the preceding operation's notification, private-save tests
  keep refusals observable, cross-tab clocks pause at the leading frame, and image
  cancellation holds a real export slice. No retry or longer assertion timeout is
  used as a fix. The full historical Nightly list and Mac classifications are in
  [the dated portability audit](../design-review/2026-10-17-portable-gate.md).
- The 24-worker sweep exposed four failures: a late export notification, an
  unmeasured initial Lab fit, redundant benchmark setup, and CPU starvation at a
  held-font cancellation boundary. Tests now wait for those real boundaries and retain the export,
  recovery and cancellation assertions; the dedicated large export still checks
  real progress and painting.
- Review round 2 centralizes E2E profile environments/output directories and the
  shared CI build entry point without changing CI projects or parallel build timing.
  Connected quick-add shares one pure placement calculation. Stamp integration
  exercises failure, late tree/HEAD changes and complete success. Browser coverage
  observes frames between unheld clone-progress updates and checks selection zoom
  only after Inspector reveal, measured fit and a stable viewport.
- The committed skill viewer is regenerated without a plugin version. No parity
  golden changes are intended; output parity must remain unchanged.
