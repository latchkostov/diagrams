## Linux Nightly readiness

The RTL tutorial regression now waits for its lazy description and planning sections before scrolling to Simulation, then waits for that section's layout. The field/disclosure priority and dock-placement assertions are unchanged.

The benchmark harness reads pane geometry, camera readiness and the transform together. Its regressions reuse one DevTools session, avoid duplicate setup/Fit waits and use the existing performance fixture's action traces and failure screenshots without per-call DOM snapshots. The 100-node workload, CPU throttle, gestures, hit checks, exact camera checks, polling intervals and test deadlines stay unchanged.

## Output parity

All 3,178 goldens pass unchanged. No golden is re-recorded. An additional viewport test id was rejected because it changed exported SVG metadata; the harness uses existing node test ids instead. The final change has no product-bundle or generated-skill diff.

## Investigation

Both reproduced races predate the seven suspected merges. The coach's held-planning reproduction fails ten of ten times both before #420 and at #420. The benchmark fails four of ten times before #420, at #420 and at #421 under the same loaded configuration. The driver-handoff case records zero failures in thirty unchanged production-build repetitions, so it reaches the requested stopping threshold without a claimed collaboration repair. Full evidence and final checks are in the dated investigation fragment.
