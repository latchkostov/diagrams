## Confluence accepts renamed diagram files

Choose or drop a diagram saved from Live Diagrams with any `.json` filename, including numbered
downloads, names with spaces and uppercase extensions. Uploaded files remain available when editing
the macro. Invalid JSON diagrams still fail content validation; the 8 MB limit, same-page checks
and pinned download versions remain enforced. File guidance is shorter, with Arabic translations
and isolated left-to-right text.

The `node/i18n/catalogs.json` parity golden changes intentionally in three fields: Arabic has two
fewer fallback messages (1,851 to 1,849), its `viewerForge` digest reflects the two new translations,
and the pseudo-locale's `viewerForge` digest reflects the shorter filename guidance. No diagram,
simulation, planning, rendering or export goldens change.
