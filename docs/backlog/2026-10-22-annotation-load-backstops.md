## Annotation persistence and menu tests under CPU contention

The circuit-breaker load check, eight Chromium workers on a three-CPU Linux container,
hit the existing 30-second whole-test backstop in `tests/e2e/annotations.spec.ts`:

- `inline auto-growth and inspector text stay within persistence limits on reload`,
  waiting for the persisted 20,000 px height after reload (line 913).
- `adds text, a note, a zone and each shape from the canvas menu`, opening the canvas
  menu while adding the later shapes (line 53, called from line 982).

The interrupted run completed 78 of 129 tests: 76 passed, two failed. Neither
assertion nor timeout was changed. The affected spec is being checked twice on the
clean `2153bf3191f6d1acf067ab2e09104f76fde397ed` master baseline at the same resource
settings; the PR's verification report records that result. The complete neighbour
set is also checked with eight workers on eight CPUs.

Keep the persistence bounds and pointer/camera assertions. Investigate the expensive
large-text setup and menu preparation under contention before changing any backstop.
