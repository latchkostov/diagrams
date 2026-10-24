## E2E setup review

The reopened-diagram test uses the existing Fit command to bring its next target
into the current pane. Pointer coverage remains enforced, and save destination
assertions are preserved. The checks probe changes only its unmeasured waiting
protocol; it retains every measured input and assertion. These test infrastructure
changes add no product controls or application behavior.
