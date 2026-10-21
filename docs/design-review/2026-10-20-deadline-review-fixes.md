## Request deadline review fixes (#197)

The existing inspector Timeout field and trouble callout remain the only surfaces involved;
no controls or permanent chrome are added. Restoring a saved integer on blur now clears both
visible feedback and aria-invalid. Incomplete keyboard input retains feedback while still
displayed; replacing that draft with a valid external value clears it.

A saved explicit no-timeout override now receives the same **Add a timeout** action as an
omitted timeout. Browser coverage checks the restored field, hidden feedback, callout action
and its single undo step with fake clocks and data-testid selectors.
