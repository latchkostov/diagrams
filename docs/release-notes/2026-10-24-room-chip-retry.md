## Room chip Retry

Restore Retry in a failed room's chip menu, including builds without configured trackers. Retry keeps keyboard focus on the host's chip or the joiner's waiting region through the existing interaction policy.

The no-server explanation, file guidance and omission of Retry from the failure alerts remain. The Retry fix changes no output golden.

## Upstream sync

Sync with the tutorial runtime changes required regenerating `node/i18n/catalogs.json` from the merged catalogs. Relative to upstream, it retains this PR's seven English validation/recovery messages and their workspaceValidation/workspaceRoom namespaces: 3,095 messages become 3,102, with corresponding fallback counts. Existing namespace hashes stay unchanged. The targeted i18n parity recheck compares three goldens with zero differences; no other golden changed during this sync.
