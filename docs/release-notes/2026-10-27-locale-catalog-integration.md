## Locale catalog integration check

The standalone exclusion test now derives numeric lookup keys from the same complete rule as the
compiler: long optional tutorial, AI and export messages join messages whose translations differ
despite shared English. The standalone assertion and catalog bucket assignments are unchanged.
The collision-specific compiler test still checks the exact set, including the optional baseline.

The German key-list diff contained 290 numeric replacements and 275 removed text lookups, a net 15;
Arabic also differed by 15, and the pseudo-locale by 16. These shared tutorial sentences account for
the count difference (each group previously collapsed to one expected text lookup):

- `tutorials.{apiGateway,cacheAside,kafkaTopic,queueWorkers}.addHint`
- `tutorials.arrange.{align,box,tidy}{Goal,Tip}` (three pairs)
- `tutorials.backoffBudget.jitterExpectGoal` and `tutorials.retryStorm.expectGoal`
- `tutorials.boundaries.{fitGoal,fitTip}`
- `tutorials.{capacity,faults,readANode,savedSimulations,traceSlowmo}.liveDone`
- `tutorials.dependencies.{hideGoal,hideTip}`
- `tutorials.sharePresent.{presentGoal,presentTip}` and `{shareGoal,shareTip}` (two pairs)
- `tutorials.{readANode,traceSlowmo}.liveGoal` (pseudo-locale only)

No standalone-only message leaked. Emitted catalogs retain their existing lookup IDs and bytes;
no parity golden changes or budget increases are intended.

Validation: all 720 standalone/i18n tests pass, including surface-key checks. Temporarily reverting
the compiler fix fails the added numeric-key regression. SHA-256 comparisons of all 342 complete
and bucket catalog variants are unchanged. Regeneration, i18n validation, production build and
size checks pass. Arabic core remains 37,882 B gzip, leaving 118 B under the unchanged 38,000 B
budget. The fix-round workflow leaves full-suite and golden verification to PR CI; no goldens
were re-recorded.
