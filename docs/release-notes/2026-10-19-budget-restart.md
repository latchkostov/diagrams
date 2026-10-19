## Refused Live runs require a restart

When a rebuild or scripted traffic operation exceeds its work budget, Live keeps the requested settings visible and stops the run. Play, Step, Continue and live patches stay blocked until Restart or settings that fit the budget successfully rebuild it. The translated recovery notice remains visible. This prevents an old runner from producing results for different settings, or skipping a refused injection.

Slow motion now exits a refused look-ahead without arming or resuming Live. Regression coverage includes asynchronous replay refusal and rising/falling ramp startup volume at the sampling budget boundary.

Normal simulation and export outputs are unchanged; no parity goldens changed.
