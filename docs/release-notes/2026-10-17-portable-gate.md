## Portable gate and native browser reliability (2026-10-17)

- `pnpm gate` provides Windows/macOS diagnostics, repo-local setup, targeted checks
  and full production verification across chromium, dev, subpath, internal and locked.
  Full runs queue across worktrees and stamp only an unchanged clean commit; browser
  temporary profiles live on the repo drive. `--linux` uses the pinned Playwright image.
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
  [the portability audit](GATE-PORTABILITY.md).
- Refresh the committed skill viewer as plugin 1.1.38. No parity goldens are re-recorded;
  output parity must remain unchanged.

