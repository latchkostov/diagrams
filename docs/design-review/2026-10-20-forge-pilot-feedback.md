## Forge pilot UX review

The configuration accepts the editor's native export directly; legacy attachments remain selectable.
The filename hint matches the file picker and the validation error explains both supported suffixes.
Automatic height needs no new setting. Its 480–900 px limits keep a useful reading surface without
letting tall diagrams consume the page, and help text describes the behaviour next to Height.

The macro header retains Play as its primary action and adds a secondary Maximise action. No viewer
toolbar control is duplicated. The modal replaces Maximise with Close diagram, occupies its available
viewport even when the macro has a small fixed height, and starts still. Esc and Close dismiss it;
closing restores focus to Maximise. Failed opening reports an error and leaves a retryable button.
Zoom, Fit and playback remain local; attribution and outbound app links are absent. Recording and
sequence exports also stay local; Forge permits downloads from a user gesture and clipboard writes.
The manifest keeps its default block layout because Forge has no wide/full-width option.

Browser regressions exercise the real resource and a fake bridge under the existing no-egress CSP,
including an outer iframe that mirrors Forge's automatic document resizing. Real-site auto-resizer
and modal chrome behaviour still need the redeploy smoke check; the fake host verifies our content
height contract without claiming to run Confluence.
