## Low-zoom editing and Live summaries (#378, review round 1)

Connections remain selectable and reach their context menu through the natural edge's hit stroke at low zoom. Selected connections retain endpoint reconnection and keyboard shaping; their controls follow the displayed natural route.

Merged lanes now use a sweep index and one group reference per connection, replacing quadratic membership copies and pairwise scans. Live sums each group's traffic once per update, in real messages per second, so sampling does not change stroke weight.

Zone pills omit zero counts, disappear when healthy, and use the existing accessible dark-red/white alert pair in both themes. Running-playback tests cover stopped painting and resumed painting on both renderers.

The only changed parity golden is `node/i18n/catalogs.json`: two localized messages were added for failing-only and stressed-only summaries. No browser golden changes.
