## Confluence app follow-ups

Escape in Maximise now closes the viewer's open menu, panel or dialog first. Only an
unhandled Escape closes the Forge modal. Maximising pauses inline playback, which stays
paused after the modal closes until the reader resumes it.

The settings panel keeps a successful upload checkpoint when a replacement file is
rejected, so retrying Insert or Update does not create another attachment version.
If settings fail after an upload, the alert explains that Cancel retains that upload
and points to Confluence attachment history to restore the previous version.
A failed Cancel preserves attachment loading and file validation, including reads
that finish while closure is pending. Dark primary buttons retain readable hover colours.

The still preview bounds geometry to 48 nodes, 72 connections and 12 boundaries and
allocates labels only when they are readable. Viewing and playback keep the full diagram.
Async loading, staging and save failures respect focus moved outside the iframe.
Forge's theme attribute no longer competes with the viewer's separate theme attribute.

Regression coverage includes removed configured simulations at the viewer boundary,
upload round trips in a fresh page with one bridge initialization script, stale file
validation completion, rejected closes during listing, downloading and staging, and
partial-save retries for both Insert and Update. The thirteen settings review findings
are all addressed; repeated checkpoint and failed-Cancel findings share these fixes.

## Output parity

Only `node/i18n/catalogs.json` changes: one new English partial-save recovery message
adds one message and one English fallback per translated catalog and updates each
catalog's `viewerForge` area hash. No diagram, simulation, export, layout or rendering golden changes.
