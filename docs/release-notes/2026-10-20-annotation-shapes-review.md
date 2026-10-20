## Annotation shape review fixes

Merged current master into the contributor branch without rewriting its commits.
Quick-add shapes keep every character typed while placement settles and continue typing at
the end of that text. Naming a shape belongs to its creation undo step, including connected
creation. Connected shape creation and cloning now share ordinary annotation insertion's
staged count, geometry and document validation, refusing invalid additions before history
or persistence changes. All insertion paths report the same actionable annotation-limit message.

Connected clones and ordinary duplicates share an annotation cloning helper, preserving
text size and appearance while assigning destination boundary membership. Shape padding now
reserves its intended text area. Fork/join and filled-junction labels use the same quiet fill
as other shapes and meet WCAG AA across the preset colours in both themes.

Mermaid syntax descriptors now drive the reader and writer together, without canvas catalog
metadata. Reversed trapezoids preserve their labels. Extended labels escape braces on export;
the importer also accepts literal braces inside quoted attribute values.
Draw.io style descriptors likewise stay with their converter; the canvas catalog contains only
the shape metadata needed by its menus and search.

## Output parity

The contribution's original golden changes remain described in
`2026-10-19-custom-annotation-shapes.md`. This follow-up changes only the existing
`node/i18n/catalogs.json`: one new `edit.annotationInsertLimit` message and its 37 translations
increase each catalog's message and translated counts by one and update its edit-area hash.
Untranslated fallback counts stay unchanged. No existing drawing or simulation
golden is intentionally changed.

Five new goldens under `node/annotation-shapes/` cover the Lab's complete shape fixture:

- `annotations.json`: all 44 shapes and both solid silhouettes in all seven preset colours.
- `outlines.svg`: their rendered SVG geometry and fill classes.
- `drawio.drawio`: native shape styles, labels and dimensions in draw.io output.
- `mermaid.mmd`: classic brackets and extended shape syntax.
- `mermaid-read.json`: the labels, inferred stencil nodes and layout when importing that output.

## Scope decisions

No new always-visible controls or higher bundle budgets. No simulation, planning or stencil
feature was added, so the complete annotation showcase lives in the Lab. Existing public
examples retain their outputs.

Additional picker glyphs and the secondary diagram/bulk inspector panels load on use.
Shape geometry and the plain annotation text editor stay in the canvas's initial code so
exports and the first keystroke never wait for those downloads. The startup chunk pin adds Rolldown's shared
live-binding helper; startup, canvas-first-view and live-session byte budgets are unchanged.
