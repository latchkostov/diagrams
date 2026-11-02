## Keyboard selection review fixes

Extend selection now reveals its destination while preserving every selected item, including when the selection spans more than the canvas at 100% zoom. With nothing selected, Next node and Previous node work from Selection actions, including the collapsed Inspector, starting at the canvas's remembered destination. Ordinary Tab keeps its canvas focus restriction.

Pointer and keyboard area selection share measured absolute boxes and eligibility rules. Selection menus index endpoint labels once and build removal labels only for selected items. Select similar uses the canonical node and edge eligibility, so annotations no longer offer a command that does nothing. The area dialog's lazy-loading browser contract now covers its real action, modal shell, export policy and Retry recovery. No controls or shortcuts were added.

## Output parity

Only `tests/parity/goldens/node/i18n/catalogs.json` changes: the master merge combines the 16 phase B selection strings with master's boundary announcement keys, updating message counts and catalog hashes. The boundary announcements retain master's `menu.selectionAddedBoundary` and `menu.selectionRemovedBoundary` keys. Their Arabic ICU templates share the count outside the plural branches, preserving the rendered text for every plural category while recovering core catalog bytes after the new keys renumber compiled messages. The template refactor leaves the catalog's rendered fingerprints unchanged. No other golden is intentionally changed.
