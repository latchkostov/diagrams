## Device saves survive navigation and example edits

A pending device Save now finishes writing its captured content when you switch diagrams or make
the first edit to a public example. Its destination still belongs to the initiating document session,
including that example's first owned copy. Unexpected write failures, including browser AbortErrors,
show the existing error toast instead of disappearing silently. Cancelling the system picker still
leaves the file alone.

Tutorial Restart, Exit and sandbox replacement retain their explicit cancellation token. Sequence PNG
exports capture their source and cancellation token before asynchronous conversion, so a late download
cannot be attributed to a different diagram or escape tutorial cancellation.

No output goldens were re-recorded. Diagram content, sequence rendering and export formats are
unchanged; the refreshed skill viewer includes the sequence PNG ownership fix.
