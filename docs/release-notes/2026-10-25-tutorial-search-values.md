## Tutorial search values · PR #356, final review fixes

Tutorial stencil queries now come from the catalog labels that search actually indexes, including rail,
quick-add and insertion searches. The command palette lesson derives its goto query from the same catalog
label creation stores (`Kafka Topic`), and interpolates that value into the instruction, coach mark and
solution. Its add instruction also uses the app's translated command label and the actual seed node name.
Removed 26 duplicate search translations and the duplicate topic-name translation from English and all
37 translated catalogs. Required node names, subtitles and configuration keys remain shared with their checks.

The locale sweep also found translated `OrderShipped` filter values in Spanish, Hindi, Russian, Slovak
and Turkish. That instruction now interpolates the same value as the saved filter and demo in every locale.
Gallery Tutorial chips derive their accessible names from their visible translated text and example title.

Technical spellings `p95`, `p99`, `ms` and `RPS` are protected by the glossary, validator and catalog tests.
Corrected page-number readings, transliterations/capitalization of p95 and translated ms spellings in
ar, bg, cs, da, de, et, fi, he, hi, hr, hu, id, ja, ko, lt, lv, nb, pl, ro, ru, sk, sl, sr-Latn, th, tr,
uk, vi, zh-CN and zh-TW. p99 and RPS already retained their spellings.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: catalog counts fall by 27, and tutorial
fingerprints reflect the shared-value placeholders and token corrections. Token corrections also change threads, waitChecks, admission and autoscaling fingerprints where those
messages contained the tokens. The hover fingerprint changes because removing the duplicate Queue search
translation lets the existing translated stencil label serve the shared Queue label instead of English fallback
(reducing each real locale's fallback count by one).
The pseudo-locale fingerprint follows the English changes. The other two i18n goldens remain unchanged;
no diagram-output golden was updated.

No search aliases, ranking rules, simulation behavior, size budgets or ZIP limits changed.
