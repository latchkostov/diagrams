## Confluence settings review fixes

The panel retains one primary action, Insert or Update, with Options folded by default. No controls
are added. The existing inline status explains rejected input during loading or saving and receives
focus. Drag feedback now agrees with whether a file can be accepted, including disabled fieldsets.

Recoverable attachment errors restore keyboard access to Choose. Invalid replacements keep the
previous preview, filename and valid selection, with the rejection shown in the status. File loading
and simulation validity are independent, preserving the existing options while preventing premature
submission. Cancellation remains available during initialisation and file validation.

The eight approved light/dark screenshots cover empty, chosen with Options closed/open, and editing.
The successful states retain their existing geometry, theme tokens and chrome budget. Regression
tests cover deferred bridge requests, file reads, upload retries, distinct committed content and
size changes. The design needs no new settings or confirmation steps.
