## Tooling follow-ups UX review

This maintenance batch adds no controls, text or interaction changes. Simulation settings remain
progressively disclosed, with the existing loading status and retry behavior. The tests follow the
rename focus and call-settings readiness states without adding waits based on elapsed time or
loosening field validation and undo coverage. Active older surfaces remain output-ready across HMR.

The ZIP shutdown regression exercises only the developer server lifecycle. No browser-facing
compression change or new resource indicator is needed.
