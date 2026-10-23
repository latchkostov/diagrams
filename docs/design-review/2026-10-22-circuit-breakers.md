## Circuit breakers and simulation overrides

The breaker stays on the request connection, in the Inspector and its Simulation context menu.
Only On/Off appears initially; tuning is behind Breaker details. No top-bar or floating-bar
controls are added. At 1024×768, the reviewed light-theme screenshot clearly places Off beside
“In this simulation · diagram: On”. Settings edit the effective saved simulation and support Undo.

Open and Testing reuse the existing pill and placement pass. Words and symbols convey state,
with the local 503 explained in the accessible title. Closed breakers remain quiet.

The designer review found two issues, both addressed: a background download's only Retry could
expire or be replaced by export success, and the cumulative fix ladder's concise button did not
disclose all its changes. Download recovery now stays in the existing callout area until it succeeds;
its regression exports while failed and verifies keyboard recovery. Fix detail now describes the
combined backoff, budget, breaker and attempt settings, including in compact callout titles.

The review directly inspected the 1024×768 override screenshot. Expanded details, menus, Testing,
dark theme, presentation and translated layouts were reviewed in code; the broader browser gate
provides regression coverage without claiming a separate visual audit of every variant.

An earlier topology-edit chunk split was rejected because the trouble-detector split already meets
the live-session budget and avoids adding another asynchronous mutation boundary. Budget increases,
unconfirmed fix fallbacks, automatic scaling of retry storms and shedding in this PR were rejected
in accordance with the approved design.
