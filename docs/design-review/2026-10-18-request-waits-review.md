## Request waits review corrections

A designer agent reviewed the changed readouts against the UX principles. The fixed execution pool now
uses the same finite admission limit for its meter, busy chip and hover text. No new control or chrome is added.

The review caught three adjacent inconsistencies, all corrected: an unknown pool no longer displays an empty
bar, its hover omits an infinite throughput ceiling, and fractional effective dot weights retain their decimals
in the Inputs selector, control-bar hint and event log. Unknown capacity remains available as descriptive text
to assistive technology without invalid numeric ARIA attributes. Existing finite-pool meters keep their texture,
waiting indicator and footprint.

Source and server-rendering checks cover unknown capacity and fractional labels. A production browser
regression checks a saturated fixed execution pool's four-slot meter and busy chip. Historical models still
have no thread meter. Planning, replay and import/export retain the same existing entry points.
