## Simulation basics tutorials

Added seven lessons for rates and Inputs, reading a node, capacity, slow motion, saved simulations,
Faults and authoring a Drill. They reuse the tutorial runner's published Live readings and normal
controls. Tutorial code stays behind the existing lazy surfaces and development/E2E flag.

Capacity is quarantined with `owner decision pending: Bottleneck callout "open" step`.
Trace in slow motion is quarantined with
`owner decision pending: Sequence diagram "open" step (trace-slowmo)`.
Their supported steps are authored; neither lesson invents an open state or changes the runner.
Saved simulations is also quarantined pending a decision about pausing the first retry narration:
the specified public run currently has no pausing note, so waiting and Continue cannot occur.

The intended golden change is `node/i18n/catalogs.json`: 110 new English tutorial keys raise
every language's message count by 110 and change only its tutorials-area hash. The 37 translations
gain 104 English fallbacks (six plain texts reuse existing translations); the pseudo-locale
generates its 110 new messages without fallback.
No existing translation or diagram output changes. Existing public examples supply the scenarios.
