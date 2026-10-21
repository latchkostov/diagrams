## Confluence: choose a diagram, then Insert

The Confluence macro now opens with one file chooser and a drop zone. Choosing a native or legacy
Diagram file validates its suffix, 8 MB size limit and native content locally, then shows a still
thumbnail and filename. The file stays in memory until Insert or Update; Cancel discards it.
Same-name files add an attachment version. Replacing an existing macro keeps its attachment ID and
filename. Permission failures show inline and never save macro settings; a failed settings save can
be retried without uploading another version.

Options holds Free play or a saved simulation, Auto size or Small (480 px), Medium (640 px), Large
(800 px), and Follow Confluence, Light or Dark. Existing custom heights stay selected until changed.
The settings panel follows Confluence's theme using Atlassian tokens, including keyboard focus and
inline error announcements. No component dependency or additional viewer runtime is added.

Output parity intentionally changes only `node/i18n/catalogs.json`: the new `viewerForge.*` messages
change message/fallback counts and that namespace's digest across locales. All other namespace
hashes and diagram, simulation, export and browser goldens remain unchanged. Screenshots are local
artifacts under `tests/.output/forge-config-shots/`.
