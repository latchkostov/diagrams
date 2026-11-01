## Cause

Round-six dispatch 41294360339, source 8e530736c49be3c0fed5b5973aa926a5ed394efb, fails the 390×844 phone instruction hit target in macOS, Linux Dev and all three Build repetitions. The helper waits for visibility, then samples the instruction's exact centre once immediately after changing the phone dock snap. Visibility does not acknowledge that layout has exposed that point.

## Repair and regression

Poll the identical elementFromPoint predicate at the identical centre, keeping the viewport/visibility checks, target, expected result and existing assertion deadline. No geometry, tolerance, camera rule or product behaviour changes. The original phone tests still run in full at both orientations.

A real DOM cover holds the hit target while the instruction is already visible. The helper must stay pending until the cover is removed. Temporarily restoring the single read fails that regression; the repaired regression and both phone orientations pass twice on two Windows CPU cores with three workers. The complete runtime spec also passes both loaded Linux repetitions (18 cases, six workers/four CPUs). The subsequent native dispatch is recorded in the round-six verification fragment. The earlier dispatch predates this final observation repair.
