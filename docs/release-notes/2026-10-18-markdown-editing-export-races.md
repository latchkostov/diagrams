## Annotation editing and image export readiness

Annotation editing now opens synchronously with the canvas, so immediate caret movement,
Enter and Shift+Enter reach its text field. Previously the lazy editor could mount after
those keys, select the original caption and let subsequent typing replace it. Markdown
rendering and the inspector's Markdown editor still load on demand; annotation editing
and its small keyboard helper remain outside the initial application entry.

Image export inserts its header before its first asynchronous wait, including in the dev
target. It then waits for Markdown rendering and decoded header images before measuring
and capturing the diagram. Input stays held during loading, and cancellation or a failed
download removes the temporary header.

No output goldens are intentionally changed.
