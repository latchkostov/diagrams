## Safer Markdown and accessible documentation (#179 review fixes)

Markdown from files and links now normalizes line endings, guarantees forward progress, limits
combined nesting and parsing work, and bounds table columns and generated cells. Excess content
remains literal text. Bracket matching uses a single delimiter scan and thematic breaks use a
linear scanner.

Documentation previews scroll, Tab navigation works normally, Escape focuses Preview, and
Ctrl/Cmd+] / Ctrl/Cmd+[ preserve selected text while indenting every selected line. Documentation
badges are named keyboard buttons. Invalid clipboard descriptions are rejected before rendering.
Images follow separate app/offline resource policies, with descriptive links for unsupported
sources. PNG/SVG diagram descriptions render Markdown through the shared component.

## Output parity

Thirteen goldens intentionally change. For each of `kafka-order-pipeline`,
`branch-to-datacentre` and `aks-app-config-key-vault`, in both light and dark themes,
`browser/images/<example>.<theme>.svg.txt` records the shared Markdown wrapper and paragraph;
the corresponding `.svg.json` adds two DOM elements. Sizes, geometry and all PNG goldens stay
unchanged. `node/i18n/catalogs.json` records the new documentation-button label in the source
catalog and English fallback counts in the other languages. No simulation or layout golden changes.
