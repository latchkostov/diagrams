## Confluence settings preview and spacing

The settings card now fits the whole node-and-boundary drawing into a 140 px preview with 12 px
inner padding, centred without stretching. Small drawings can grow to 1.5 times their original
size. Labels appear only when their fitted size reaches 9 px; smaller previews show clean shapes
and connections, with the filename beneath them.

The panel owns its 20 px inset, including footer buttons. The footer separator spans the panel,
sections have 14 px spacing, and the title has a 12 px gap. The existing controls and file flow
are unchanged. All eight light/dark screenshots are refreshed in
`tests/.output/forge-config-shots/`. The polish changes no diagram-output golden. Syncing the
existing settings redesign with master regenerates only `node/i18n/catalogs.json`: the combined
catalog keeps master's messages and the redesign's `viewerForge` messages, updating message and
fallback counts and only that namespace's fingerprints. No golden was hand-merged.
