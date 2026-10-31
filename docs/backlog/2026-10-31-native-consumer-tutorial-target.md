## Cause and scope

Nightly 41209418763, Windows shard 1, times out waiting for `trouble-add-consumer` in the backlog tutorial. Its failure snapshot already contains the capacity callout's Nobody reads Jobs and Add a consumer button at simulation time 51. `troubleLeads` intentionally lets this capacity diagnosis replace the same queue's lag callout. The recipe target existed only inside the suppressed Trouble action, making this a real tutorial dead end when the heat map leads.

Expose the same tutorial target inside the capacity callout's existing Add a consumer button. The two floating callouts are alternatives in `LiveSession`; retain their priority, existing button selectors, handlers, accessible names and all original tutorial assertions. Do not change detection windows or add another callout.

## Regression evidence

A mounted component regression activates the tutorial target while capacity owns the action and verifies the existing consumer handler receives the queue ID. Temporarily restoring the original capacity button fails with a missing target; all four callout tests pass after restoring the fix. The callout, unread-broker and tutorial units plus startup/reserve heavy tests pass all 68 cases. Native Windows and Linux each pass ten executions across two repetitions of the backlog tutorial and heat-map neighbours. Loaded Linux passes all 25 executions across five repetitions at eight workers and four CPUs. Build, size and all 3,178 unchanged parity goldens pass. The i18n check reports zero errors; no wording changed.
