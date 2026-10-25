## Recovery stays in the modal

The gallery placeholder shows the existing translated download error and one inline Retry only after
failure. It uses the shared lazy-surface retry callback and stays inside the dialog's normal Tab loop.
No permanent chrome is added. Search and feature state stay in the shell. When Retry disappears and
leaves focus on the body, the still-mounted shell restores search during retry or successful loading;
completion leaves focus alone if the user has already moved to another control.

## Preserved descriptions and export boundaries

Lab enrichment stays inside the already-lazy preset registry, restoring tooltips, description search
and header copy without adding rich metadata to startup. The keyboard regression traverses with Tab
and Enter, including another failed retry followed by success; it never focuses Retry directly.
Non-modal discovery retains its shared toast. Export tests assert discovery is both loading and active
before and after completed downloads. SVG uses a populated diagram with the gallery concurrently
mounted, preserving the existing rule that an empty diagram has no image to export.

## Scope decisions

Rejected new recovery machinery and eager metadata imports: existing retry and shell state suffice.
Blank-SVG behavior changes, unrelated type redesign and budget increases are outside this fix round.
No simulation, planning or stencil feature was added, so no showcase content is needed.
