## Cache-aside condition feedback (#439, round 1)

The When control stays in the existing Request details disclosure. This round adds
no controls or menu entries. Choosing Every request removes the automatic write-back
explanation and its aria-describedby reference together; Undo restores both. Dormant
conditions in older models or without configured cache rules also omit that claim.
The select keeps its accessible name, current focus and existing translated options.

English and Arabic browser regressions cover disabling and undoing the condition;
component regressions also cover absent rules and an older model. Existing bidi
isolation of the cache name remains intact. No new UI text or translation keys are
needed. Keeping the condition metadata on a decorative reconnect preserves the
document's reversible edit while Checks follows only simulation connections.

## Measurement fixtures

Viewer setup consumes a resumed frame before batching its remaining setup interval.
The Checks typing fixture forces its explicitly requested idle start before the
existing measured paint boundaries. Both retain their original assertions and
timeouts. These changes add no product controls, text, viewport behavior or camera
rules. Broader frame-detail rendering changes were rejected after profiling.
