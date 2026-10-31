## Tutorial gateway bypass evidence (PR #404, R-0b81a726f3)

The combined negative test in `src/tutorials/verifiedBlocks.test.ts` supplies an empty
gateway seed without a LiveController, so it does not prove rejection of bypass wiring.
Add a dedicated running-diagram test: construct the completed API gateway lesson, prove
the valid saved run passes, then play an incorrectly wired variant and assert rejection.
Deferred from fix round 1 as requested; the Undo reconstruction and four named P2s are
handled in that round.
