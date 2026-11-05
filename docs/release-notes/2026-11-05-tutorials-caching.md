## Tutorials: caching

Six hands-on lessons teach caching with plain labels and technical names in the explanation:
Cache at the edge; Where the hit ratio comes from; Faster at p95?; A cache stampede;
Serve stale while refreshing; and A deploy empties the cache. The introduction explains hits,
misses, origins and freshness before asking for a rule. Cache-aside remains the existing lesson
until its dedicated model change is available.

Learners edit real cache rules and Inputs, apply the stampede callout, author a Cold cache Drill,
and compare actual counters and outcomes. A fresh hit ratio counts only requests since its
step began. Hard and soft purges are matched by mode, target and time. Family selectors accept
equivalent vendor stencils. Assistance preserves unrelated edits, Continue reconstructs the work,
and the tutorial sandbox still never saves a diagram implicitly.

The hub now contains 68 lessons, including two optional extensions: 66 core lessons, with chapter
counts 14, 14, 11, 8, 11, 6 and 4. The existing chapter and whole-syllabus seals include the new
core lessons. English and Arabic lesson strings are included; public example labels retain their
visible names in translated instructions.

The only intended golden change is `tests/parity/goldens/node/i18n/catalogs.json`:
all 38 catalog records gain 106 tutorial messages and a new tutorial fingerprint. Arabic
supplies those messages; untranslated locales retain their English fallback. Other namespace
fingerprints, the fixed message samples, route catalogs and all diagram-output goldens stay
unchanged. The complete Node parity comparison checked 3,223 goldens before recording this
catalog change. Final browser and commit-gate results will be recorded after admission.
