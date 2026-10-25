## Message types review fixes

- Appended processor rules stay visible and keyboard reachable after rename, Undo and reuse of the old name on another rule. Each immutable history snapshot identifies its own appended row.
- Escape dismisses focused message cards in read-only viewers. Dialogs and menus retain precedence, and the edge keeps focus.
- Carries and filter searches rank exact names first. Omitted matching selections and unselected choices are counted separately from all hidden selections, so a search cannot conceal its overflow.

The fixes affect transient inspector and keyboard behavior, without changing saved diagrams or simulation output. Sync regenerated only `node/i18n/catalogs.json` to combine master's catalog with this branch's existing `messageTypes.search` key: each language gains one message and a changed `messageTypes` area hash; untranslated catalogs gain one English fallback, while `en-XA` gains none. No other golden changed.
