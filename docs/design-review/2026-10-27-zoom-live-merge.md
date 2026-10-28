## Zoom identity and Live integration review

The merge preserves the existing camera and editing contracts: titles travel with their regions,
identity scaling holds during a gesture, and Live clicks cannot begin editing connections. It adds
no controls or text. Hidden Overview readouts do not need frame measurements; visible readouts and
explicit measurement requests still invalidate detail. Mixed mutation batches retain traffic ink
updates without measuring the canvas again.

Retain the indexed, batched label placement rather than restoring per-edge scans from the older
FrameDetail implementation. Retain the viewport movement trigger and dirty camera subscription
alongside Live's hidden-readout filter.
