## Finish redesign output validation

The part-1 parity attempt found the intended catalog signature change, then the Linux browser tier's preview server failed with ENOMEM. It reported 5 passing and 105 failing browser cases after the server died; no goldens were rewritten. This is incomplete validation, not proof of a baseline failure.

At the redesign spec's step 12, rerun parity with available memory, inspect the expected viewport/catalog changes and record only deliberate output changes. Keep the budgets fixed. The current build spec explicitly reserves parity recording for that step.

## Cold gate server readiness

Two post-fix Workbench smoke gates timed out on webServer startup before running any browser case. The dev process reported its port as ready, but the gate readiness check did not complete within its existing backstop. The production-only, budget-reserved Playwright runner passed all nine smoke cases and all ten targeted regressions. This has not been proven to reproduce on clean master; no baseline claim is made. Investigate readiness under the shared load without raising timeouts. Full CI and Linux neighbour repetitions remain required validation.
