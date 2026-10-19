## Waiting requests: final review

Live call pills use pre-inflated spatial indexes and reuse placements while counts keep the same text dimensions. Offscreen connections skip placement searches; dense drawings wait for room. Pills reserve space for live thread readouts and for other active pills.

Sampled reply handling retains the admitted request's occupancy, including API, endpoint and shared concurrency limits. Retained-memory estimates use admitted demand, including quotas, rather than traffic the service rejects.

Caller controls withhold edits on unsaved simulation drafts, including drafts with a saved simulation's ID. Clearing a saved override immediately inherits the diagram's value and preserves that behavior after reload.

The fixes leave diagram-output goldens unchanged. Rebasing onto Watch Live together changes only `node/i18n/catalogs.json` in this round: the combined catalog has 2,404 messages, including master's 16 new collaboration messages (the collaboration area fingerprint and translated catalogs' fallback counts change; the pseudo-locale keeps zero fallbacks). Relative to master, it also retains this branch's 21 caller/thread messages. The conflicted golden was taken whole from master, then regenerated with `pnpm parity:update i18n`; no golden was hand-merged. Regression tests cover the corrected edge cases outside the frozen runs.
