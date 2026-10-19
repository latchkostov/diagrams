## Preserve existing documentation

Long descriptions and node documentation now load losslessly from native imports, the library and autosaves. The import-only whole-document size cap no longer hides documents already in storage. Editors continue to refuse edits beyond their authoring limits; rendering keeps its shared work and output budgets and preserves excess content literally.

Nested list containers now count toward the output budget, and plain text skips delimiter indexes. Regression tests cover legacy content, bounded rendering, and both selection endpoints after refused formatting settles. All 2,525 parity goldens are unchanged.
