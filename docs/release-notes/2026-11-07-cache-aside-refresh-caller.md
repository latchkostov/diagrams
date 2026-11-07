## Cache-aside refresh preserves the caller's request

Background refresh now reuses the caller's selected conditional origins and its
pre-lookup message type and request address, just as a cold miss does. Renaming or
readdressing the cache lookup can no longer omit a required database or refill
after only a successful sibling. Origin selection shares one helper with cold
misses and does not draw fan-out choices again.

If the caller has already ended when the stale lookup completes, refresh is
skipped because its original request context is no longer available. Both live
call and ended-call behavior are covered across checkpoint restore. No new
controls or document fields are introduced.

Five regressions fail with the pre-fix engine and pass with the correction. The
targeted engine gate passes 873 tests, including cache-aside, agreement, heavy
cache tests, w3-noop and checkpoint bounds. All 306 Chromium, Firefox and WebKit
digest checks pass. Lease checkpoints remain 131,292 B, 104,175 B and 82,479 B at
scales 1, 10 and 50, below the unchanged 133,120 B bound.

The size check also exposed prior cache-copy growth on this branch: Arabic was
97,697 B gzip against its 97,500 B limit (clean master 8d86d8660 is 97,481 B).
Long plain cache explanations now use the compiler's existing numeric lookup
representation, retaining all translations and loading boundaries. Arabic is
97,341 B after the change. Its regression also fails with the optimization
removed; all 291 focused catalog, bucket and cache-aside tests pass.

Full parity passes 1,995 Node tests and 112 Linux browser tests: all 3,376 goldens
are unchanged, with none added, missing or stale. The subsequent catalog-only
parity check also preserves all three i18n goldens. No golden was re-recorded.

## Downloadable skill reserve

The single full Linux gate exposed a skill ZIP of 829,876 B against the unchanged
828,856 B reserve bound; the same focused check passes on clean master. The
read-only viewer still imported editor context-menu and routing-authoring CSS
despite excluding their components. It now imports only shared route colors and
swatches, retaining the fade animation used by dialogs. The editor keeps its
complete styles. The ZIP is 828,851 B, preserving the 6,144 B reserve. Both affected
skill checks pass; restoring the old viewer imports fails the regression. An
attempt to compact generated module identifiers produced identical bytes and was
discarded.
