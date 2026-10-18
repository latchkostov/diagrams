## Example gallery: retire, merge and feature decisions for the owner

The five large showcases (release note `2026-10-18-large-showcase-examples.md`) supersede or overlap some smaller
examples. Nothing has been retired, merged or re-featured; each item needs the owner's decision.

- Retire `multi-region-active-active`, or fold its failover story into `cell-based-bookings`.
- Merge `iot-telemetry` into `ev-charging-network`, or fix its unexplained `capacity:hot` warning.
- Merge `aws-fanout` into `aws-serverless-orders`, or give its archive and receipt queues dead-letter routes.
- Give `azure-service-bus-integration`, `notification-fanout` and `rag-assistant` the missing DLQs (and the
  notification senders an identity), so no example carries an unexplained finding.
- Feature `black-friday-commerce` on the start card instead of `aws-serverless-orders`.
- Later: one "Autoscaling basics" example from `autoscaling-image-workers` and `keda-render-workers`; a translated
  "Full systems" theme for the large examples; four more proposed large examples (feature store and model rollout,
  video-on-demand, observability pipeline, hybrid enterprise network).

Local tooling note: Vitest's file cache can keep a stale `src/examples/metadata.ts` transform after a new example
JSON is added (the plugin reads the JSON files, but the cache keys on `metadata.ts`). `gallery.test.ts` then reports
`shows` as undefined for the new example until `node_modules/.vitest-cache` is cleared. CI starts clean.
