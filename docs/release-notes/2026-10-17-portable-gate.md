## Portable local test gate (2026-10-17)

- `pnpm gate` provides native Windows/macOS setup, diagnostics, targeted checks and a complete production test run across all five browser projects. `--linux` uses the pinned Playwright image and committed source.
- Full verification keeps clean-commit stamps, machine-wide queuing, exclusive ports and persistent reports; browser profiles live on the repo drive. No parity golden changes are intended.
- UX review: developer tooling only; no editor controls or flows change.

