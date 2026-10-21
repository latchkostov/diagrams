## Standalone W1 ledger review

This correction uses the existing simulation model and adds no controls, settings, chrome or
UI text. Standalone workers now complete their first logical wave on scale one's timeline,
while the ledger retains the represented cohort's capacity. This makes Live's existing counts
more accurate without adding a choice for the user.

The review keeps caller accounting separate: widening `callerReservations` would change memory,
occupancy and autoscaler readings beyond this fix. Release quantization and all existing output
goldens remain protected. Existing public queue examples already exercise standalone workers;
this correction adds no new simulation, planning or stencil feature requiring a new showcase.
