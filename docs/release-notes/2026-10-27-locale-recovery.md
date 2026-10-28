## Catalog loading and recovery

Shared bezel, rail and dock labels stay in the core catalog, including Theme, Light, Dark, AI, unread counts, Undo and the command palette’s Simulations group. A source check guards the eagerly rendered shell against optional-catalog keys.

Gallery, command discovery and Lab catalog downloads use recoverable loaders. Loading and failure messages are translated, and Retry starts a fresh attempt without reloading the page. Command discovery keeps typed input and hands focus to the search after recovery; keyboard Retry is available after a failed download.

Tutorial command titles load in a small metadata catalog; ordinary palette preloading leaves lesson translations deferred. Bucket generation, parsing, runtime types and size accounting share one manifest. The language-switch race test now uses fresh modules and explicitly held loaders.

## Validation and output

Regression coverage holds optional catalogs in German and Arabic, fails their downloads, retries and checks translated content and focus. Targeted i18n parity compared 3 goldens with 0 changed, added, missing or stale. No output goldens were edited. No budgets or reserves were changed.

Production startup JavaScript is 158,970 B gzip (entry and module preloads). Startup locale catalogs, measured separately at gzip level 9, are German 31,302 B, Arabic 37,427 B and Russian 37,193 B. Tutorial title catalogs are 1,589 B, 1,872 B and 2,040 B respectively; they load with command discovery or tutorials.

## Catalog readiness as one system

Every surface waits for its translations through one per-language readiness API. Switching language while a
surface is still downloading moves it to the new language at once; the old download can no longer hold it on a
loading message or fail it afterwards. Quick-add and Change stencil search translated descriptions only after
they arrive, showing Loading or Retry instead of partial results. The command palette's loading dialog closes
with Enter or Space on Close. Checks findings and markers arrive with the simulation strings they use, and the
planning, inspector and Live controls' shared "Advanced" label no longer waits for the AI strings.

A build check now fails when any module could show a string before its catalog is ready, naming the import
path. Startup catalogs grew slightly for file-validation errors and shared labels: German 31,700 B, Arabic
37,882 B and Russian 37,641 B (gzip level 9; 38,000 B gate). Production startup JavaScript is 159,071 B gzip.
No budgets or reserves were changed; parity reports 0 changed goldens.
