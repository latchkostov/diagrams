## Expanded annotation shapes (Mermaid catalog)

Contributed by @hfmm99: expanded shape annotations supporting 44 flowchart, process, data storage, document and connector shapes referencing the Mermaid shape catalog.

- Inspector: retains the 5 quick default shape buttons (`rect`, `rounded`, `ellipse`, `diamond`, `cylinder`) plus a compact "More shapes" picker button opening a searchable, categorized menu (Basic, Flowchart & Process, Data & Storage, Documents, Connectors & Decorators).
- Quick-add & Creation: available across all creation surfaces, including canvas context menu (Annotate ▸ Shape), Inspector, Palette, Quick-add (+ button, dropped connections, canvas double-click), and clone-to (`Alt+Shift+Arrow`).
- Crisp SVG geometry: all shapes scale cleanly to the container boundaries without empty margins, ensuring connector handles and connection lines attach directly to the visible shape outlines.
- Shift aspect-ratio lock: holding `Shift` while resizing any shape locks to a 1:1 square/circle aspect ratio.
- Interop: classic Mermaid bracket syntax is used for supported shapes, with modern Mermaid v11 `@{ shape: ... }` syntax for extended shapes, and seamless import aliasing for Mermaid flowchart shapes. Draw.io exports map to matching native styles.

## Output parity

- `node/i18n/catalogs.json`: Added `shape` area messages.
- `node/skill/files.json`: Updated `reference/format.md` and `scripts/lib/spec.json` schema documentation with the expanded shapes.
