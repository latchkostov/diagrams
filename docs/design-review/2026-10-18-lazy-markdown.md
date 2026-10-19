## PR #179: Markdown loading review

No new controls or chrome. An annotation's persisted box keeps its position, width and height while
plain escaped source becomes rendered Markdown. Existing typography and wrapping apply to the fallback;
rich content can reflow inside the box. Documentation tooltips retain their ResizeObserver positioning.

The annotation properties panel loads on first selection and notifies the focus controller after its
fields mount, preserving requests made while the download was pending. The inline editor still selects
and focuses its text on mount. Rendering never downloads the editor or its formatting keys.

Exports wait for the renderer and the synchronous publication to mounted views, then measure their
header as before. A held-download browser regression checks escaped first paint, unchanged annotation
geometry and rendered exported Markdown. Cancellation remains available during that wait.

Rejected raising the bundle budget and removing Markdown capabilities: the first view can meet its
existing budget by loading those capabilities on demand. No new showcase is needed for a loading-only
change; existing public examples and output goldens remain the behavior contract.
