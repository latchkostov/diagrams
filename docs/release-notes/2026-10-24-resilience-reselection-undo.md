## Resilience tuning keeps its Undo step

Retry and breaker edits now share a caller-policy history tag, so an intervening history flush
does not split a short tuning sequence into separate Undo steps. Reselecting the existing normalized policy
does not write another edit. New policies retain the existing resilience defaults, and separately flushed
timeout edits keep their independent Undo steps.

The CI failure occurred after Undo: retry backoff remained at its tuned value while the breaker reverted.
No default reset occurred on reselection. No parity goldens changed; this fix round runs only targeted tests.
