## Cause and repair

Round-five baseline Nightly 41253920016, macOS shard 11, emits the file download before its independently loaded success message. The test focuses an earlier notification, queues the Private toast, then releases it. The late save notification replaces the Private toast before Clear conversation can appear. The trace shows toast ids 1, 2 (Private), then 3 (Downloaded).

The test now acknowledges the actual Downloaded notification before engaging its Dismiss control. All queued-toast, focus-return, privacy-action and conversation-clear assertions remain. A regression holds the real file-message chunk with an earlier Copy for AI toast visible. Temporarily removing the message acknowledgement fails the pending-setup assertion; restored, both regression and original case pass on native Windows.

An initial regression held the message chunk across file import, which correctly prevented import completion. The corrected fixture opens a public example and creates the earlier notification through Copy for AI instead. No application behavior, timeout, tolerance, skip, quarantine or golden changes.
