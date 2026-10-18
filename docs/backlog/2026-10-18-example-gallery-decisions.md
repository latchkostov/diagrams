## Example gallery: remaining follow-ups

The owner's gallery decisions (retire, merge, improve, feature, "Autoscaling basics", the "Full systems" theme) landed
in `2026-10-18-gallery-cleanup` (release note). Still open:

- Four more large examples: feature store and model rollout, video-on-demand, observability pipeline, hybrid
  enterprise network (the second batch).

Local tooling note: Vitest's file cache can keep a stale `src/examples/metadata.ts` transform after a new example
JSON is added (the plugin reads the JSON files, but the cache keys on `metadata.ts`). `gallery.test.ts` then reports
`shows` as undefined for the new example until `node_modules/.vitest-cache` is cleared. CI starts clean.
