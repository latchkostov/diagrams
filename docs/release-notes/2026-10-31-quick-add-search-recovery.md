## Quick-add keyboard recovery after a failed search download

If search metadata fails after Enter queues a quick-add pick, the menu releases its input capture.
Escape can clear the search and dismiss the menu, and Tab reaches Retry. Retrying keeps the buffered
name and resumes capturing input until the pick completes. Editing the query cancels the queued pick
and releases its capture immediately.

Output goldens are unchanged; this fix only changes pending keyboard input and recovery.
