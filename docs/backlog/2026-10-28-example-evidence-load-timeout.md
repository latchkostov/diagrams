## Unreproduced evidence sweep timeout during concurrent verification

The initial #377 repair unit/heavy run passed 14,230 tests and timed out once in
`src/checks/examples.heavy.test.ts`, “simulation evidence on the public examples > retry-storm”.
The existing five-second hang backstop fired at 5.334 seconds. The test and engine were unchanged
by the camera PR.

This is not a confirmed master failure: two isolated case replays and the complete 83-test file
passed on clean master `093cfb14a`. Keep the observation separate from the reproduced drawing-guide
flakes. Investigate evidence work under concurrent verification if it recurs; retain the complete
simulation corpus, semantic assertions and existing backstop.

The complete evidence file also passes on Linux after rebasing onto `9020f77ad`; the final targeted
unit/heavy lane passes all 143 tests, including the bundle-reserve tests.
