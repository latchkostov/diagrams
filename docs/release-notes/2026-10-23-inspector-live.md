## Inspector Live details

Properties now presents Live as a docked hover card: the same status, verdict and vital tiles, a recent-throughput strip with a text alternative, and expandable Latency, Threads & calls, Resources and Outcomes rows. Readers and Scaling appear when applicable. The verdict's section opens by default; choices persist while the item stays selected. Connections now show their live request, retry, timeout and breaker details too.

Outcomes uses nonzero definition-list rows, keeping dead letters separate from losses. Before traffic is sampled, Live says “Waiting for the first second of traffic.” No new toolbar controls or animation were added.

Screenshots: A retry storm [before](../design-review/inspector-live/before-retry-storm-1280-light-inspector.png) / [after](../design-review/inspector-live/after-retry-storm-1280-light-inspector.png), and Webhook ingestion [before](../design-review/inspector-live/before-webhook-ingestion-1280-dark-inspector.png) / [after](../design-review/inspector-live/after-webhook-ingestion-1280-dark-inspector.png).

The only changed parity golden is `node/i18n/catalogs.json`: twelve English Inspector messages increase message counts by twelve, add twelve English fallbacks in shipped translations, and add a workspace Live area hash. The pseudo-locale gains the messages without fallbacks; translations are unchanged. Simulation, planning, exports, skill output contracts and all browser goldens remain unchanged. Generated skill viewer assets are refreshed without changing the plugin version.
