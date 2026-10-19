## Gate lease test under concurrent verification

A broad Windows unit run on this branch timed out in `src/lib/localGate.test.ts`, `holds checkout and port leases throughout orchestration (6660)`, at the existing five-second test backstop. The same focused test passed in an isolated clean `origin/master` archive (d1b2627f) and in this branch; both parameter cases passed. This is an intermittent observation, not evidence of an identical master failure.

Investigate lease-test isolation under concurrent gate/parity work if CI reproduces it. Keep the assertions and timeout intact. The initial broad run also loaded a new preview-tab-order assertion with incorrect HTML attribute casing; that assertion was corrected and passes in the focused suite.
