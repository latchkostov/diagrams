## Upstream integration and output parity

Round 10 integrates master changes #424 and #425 with a merge, preserving the published fixes.
The generated viewer is rebuilt from both parents; no handwritten conflict choice is used for it.

The one inherited golden is `node/i18n/catalogs.json`, from #424: sixteen new selection messages
in all 37 locales, plus two existing boundary announcements moved from the menu catalog into the
optional selection catalog. Its counts and catalog fingerprints change. The committed upstream
golden is retained unchanged. The native fixes add no golden changes and re-record no outputs.
