## HTML export template readiness

The agent-skill comparison opened the app's HTML dialog and immediately requested a download. The dialog can be visible while its on-demand viewer template is still loading. The existing HTML-export driver already waits for that response; both specs now share it, registering the response observation before opening the dialog.

A held-network regression observes the real visible dialog while its template request is blocked. Opening must remain pending until the response finishes, after which the real download retains its exact title. Temporarily removing the template acknowledgement fails this regression: the driver incorrectly reports readiness while the response is held. Both affected Windows cases pass; Linux repeats them twice. No product behavior, timeout, budget or golden changes.
