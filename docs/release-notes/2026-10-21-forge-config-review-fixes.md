## Confluence settings recovery and safe attachment updates

The settings panel keeps an existing macro's attachment target separate from a selected file and
its upload retry checkpoint. After a failed Insert, choosing another file resolves that file's
attachment afresh. Retrying the same file reuses its successful upload. Replace continues to add
a version of the original configured attachment, retaining its filename.

Drops, file picks and submission are rejected while the panel initialises or saves. File reads
have their own readiness state, so changing simulation options cannot submit a pending replacement.
Late reads cannot replace a newer selection. Attachment load errors restore the chooser; an invalid
replacement leaves the last valid file available to submit. A missing attachment must be restored
before it can be versioned; the panel never silently redirects an existing macro to another file.

Round-trip browser tests reopen distinct uploaded content for Insert and Update. Size preset tests
start from a different size and check the submitted height, including fixed size to Auto.

Exactly one parity golden changes: `node/i18n/catalogs.json`. The new `viewerForge.waitForFile`
message increases message and English-fallback counts and changes catalog hashes. Existing diagram,
simulation, export and rendering goldens are unchanged.
