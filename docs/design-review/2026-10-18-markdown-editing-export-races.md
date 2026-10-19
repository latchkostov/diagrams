## PR 179: editing and export readiness

Reviewed against D7 and the existing text-editing contract. Opening an annotation must
take the next key immediately, including caret movement before typing. Its small editor
and keyboard helpers therefore load with the canvas; prefetching alone would still leave
a race on a cold or stalled connection. The renderer and inspector editor stay lazy.
Enter and Shift+Enter retain native newlines outside Markdown lists; smart list handling
and Ctrl/Cmd+Enter, Escape and Tab commits retain their existing behavior.

The image export header appears synchronously, while the final image waits for rendered
Markdown and decoded images. Loading uses the existing input hold and cleanup so a
cancelled or failed export restores the page. No new controls, copy or chrome are added.
The unchanged D7 test and header-overflow test cover the reported regressions; additional
coverage checks immediate Enter and Shift+Enter, cold Markdown and delayed image decode.
