## Cache Checks review fixes (#444)

Cache warnings now pair each rule with its routed origin demand, capacity and replay evidence. A busy API origin cannot blame a light static origin, redirect its replica fix or hide its separate capacity warning. Cold-start findings deduplicate per origin while every rule still gets checked for stampedes, including stampede-only requests and reversed disjoint rules.

Short-TTL confirmations share one free-play setup and one unchanged 30-second baseline per cache, including refused baselines. A suggested lifetime remains visible without an edit when confirmation refuses, ends early or fails to improve hits. Analytically healthy caches skip unnecessary playback; exhausted probes check their existing work/message budgets before building free play. Older planning revisions keep cache rules dormant without triggering request replays. No budgets or thresholds increased.

The method-only action now says “Delete this cache rule” in deterministic output, English and Arabic; deletion and one-step Undo remain intact. Agent reports drop optional cache metadata in their smallest fallback so diagnostics with long imported IDs still fit the 1,500-character budget.

The existing Black Friday measurement harness measured total Checks at 1,788.1 ms before these fixes and 497.1 ms after. Same-run cache-disabled controls were 733.2 ms and 742.2 ms respectively; scenario sizing performed the same four runs, 11,253 ticks and 25,485 messages. Cache-only Checks fell from about 1,539 ms to 15 ms. These are local measurements, not timing assertions.

Intentional golden changes: `node/i18n/catalogs.json` records the deletion wording/key and Arabic translation (other languages use the corrected English fallback). `node/checks-words/black-friday-commerce.json`, `node/agent/check/black-friday-commerce.json` and `node/evidence/black-friday-commerce.json` remove the unnecessary unchecked-cache count and its summary prose: the configured caches cannot meet either warning's analytic conditions. No actual warning or suggestion is removed. Simulation goldens remain unchanged. The generated skill viewer is refreshed for the capacity projection metadata.
