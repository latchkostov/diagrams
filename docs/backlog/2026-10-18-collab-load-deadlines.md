## Browser deadlines under parallel CPU contention

The collaboration recovery verification repeated the collaboration suites and their annotation, drawing, inspector,
platform and viewport neighbours five times in Linux, with eight workers on four CPUs and 16 GiB RAM. It recorded
669 passes and six whole-test deadline failures, with no retries or flaky classifications:

- Annotation auto-growth/persistence after reload: three failures.
- Adding all annotation kinds and shapes through the canvas menu: one failure.
- Isolated editors, pending inspector edits, scoped history and remote deletion: one failure.
- A peer edit between image-export slices: one failure.

The four cases retain their assertions and backstops. Investigate their setup/workload and persistence readiness
under contention; avoid masking them with longer waits or weaker camera/export checks. Preserve every behavior if
splitting a long scenario into smaller tests.

Clean-master comparison uses `21c17fe35bb5ee2c919da062da300a88ba7808ab`, with an unchanged tracked tree in an ignored
snapshot inside this workspace. The verification report carries the exact baseline gate summaries and identifies
which failures reproduced; a passing baseline alone does not establish that a branch failure is pre-existing.
