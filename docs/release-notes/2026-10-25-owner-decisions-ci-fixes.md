## Owner decisions: PR #332 fix round 1

Translate the inline-rate-limit gallery summary in all 37 non-English locales, with current
source stamps. The pseudo-locale generation and its artifact checks are unchanged.

Rate limit now preserves token, byte and shared quotas even when their ID is `local-rate`.
A new local request quota uses an available ID, which remains editable and removable without
invalidating the API's unique-ID contract. Its instructions are visible below the field and
associated through `aria-describedby`, so keyboard, touch and screen-reader users can find them.

The public-example gate now includes `inline-rate-limit` and explicitly expects its intentional
`capacity:limiter` warning (20 requests/s offered to a 10 requests/s quota). Its A1 upgrade adds
only `single-point:api`: materialization makes the Catalog API's implicit one replica explicit
on the sole request path. This is expected evidence for the new example; existing examples keep
their findings and severities. No simulation or planning code was changed to alter findings.

Live double-click coverage now checks the node's open property sheet, unselected name and retained
canvas-node focus. Editing still selects the entire name; boundary, connection and F2 naming remain
covered. The joiner Retry test configures unreachable trackers on both peers, preserving Retry's
meaning while retaining separate coverage for builds without collaboration servers.

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: each of the 37 locales has one fewer
English fallback and a new gallery digest for its translated summary (74 scalar changes).
Every other Node golden remains unchanged. The generated skill viewer is refreshed by `pnpm regen`.
