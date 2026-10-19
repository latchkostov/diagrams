## Live Free play default

Live immediately shows the diagram's normal traffic and keeps saved simulations one choice away.
Explicit **Run it** and named links retain their purpose. No top-bar or live-bar controls are added.

The existing status hint explains the no-source empty state in plain words. It yields to errors
and action notices, disappears when a source is added, and stays hidden when traffic is explicitly
off or a saved simulation is selected. This follows beautiful defaults, progressive disclosure
and teaching in place without increasing the chrome budget.

Retain traffic initialization in the live-session boundary through `setTraffic`, rather than
changing the controller's replay baseline: this preserves logged startup operations, URL overrides
and host-driven playback. Existing public examples already demonstrate moving Free play traffic
within seconds; no new gallery scenario is needed for this default change.
