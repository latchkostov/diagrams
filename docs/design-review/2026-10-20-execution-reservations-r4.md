## Execution reservations review

Reviewed the changed simulation paths against the UX principles. Recovery and live
resource enabling preserve concurrency, so competing traffic waits behind work
that already owns capacity. No controls, visible labels, menu items or layout
change; the existing chrome budget is unaffected. Caller, callee and standalone
readouts keep their existing units and presentation.

This is an accounting correction to existing behavior. The focused tests verify
that enabling resources preserves the running reservation and that drain expiry
settles each delivery exactly once. No browser layout change or new public
showcase is needed. Review was based on source and deterministic engine tests.
