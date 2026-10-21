## Annotation regressions observed during Forge verification

The first Linux neighbour load pass (eight workers, four CPUs) completed 187 Chromium tests:
186 passed and `inline auto-growth and inspector text stay within persistence limits on reload`
hit its existing 30-second whole-test timeout. All 45 Forge tests passed. Further broad repeats
were stopped; no assertion or timeout was changed.

The annotations spec alone was then checked once with `--repeat-each=2`, eight workers and four
CPUs, against a clean archive of origin/master `b642f42a836cdfb613c75cc00074b505b44ef7ce`,
inside this checkout's ignored test output. That run independently exposes opposite-handle hit
test failures for hourglass, comment and brace-r: `annotation-resize-line-shape-left` receives the
hit where the test expects `handle-shape-left`. This is separate evidence, not proof that the
original persistence timeout has the same cause. Investigate annotation readiness and hit areas
separately from the Forge settings surface.

Local evidence: `tests/.output/g/r3f2XOz/e1/checkpoint.json`,
`tests/.output/g/r3f2XOz/e1/step.log` and `tests/.output/forge-polish-master-repro.log`.
