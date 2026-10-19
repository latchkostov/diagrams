## Markdown and documentation reliability

Formatting, indentation and list continuation now refuse edits that exceed a field's limit, preserving existing text and selection. Node documentation shares its 50,000-character limit across editing, updates, schema, native imports and clipboard validation. Diagram descriptions also enforce their existing 2,000-character schema boundary during editing and import.

Markdown parsing has a shared 2,048-token output budget across blocks, lists, inline spans and table cells, with literal-source fallback. Inline scanning uses indexed delimiters and a cursor, so ordinary paragraphs with hundreds of formatted spans keep rendering. Earlier nested list items survive decreasing indentation, including mixed list kinds.

Preview keyboard navigation skips the concealed editor and reaches the scroll region and links. Canvas Tab visits annotation links before advancing to the next node; Shift+Tab returns through them. IME composition keeps Escape and indentation inside the input method. Documentation tooltips use rendered dimensions and stay inside the viewport.

Regression coverage includes full-field formatting, native boundaries and clipboard round trips, saved documentation after reload and clearing, keyboard routes, tooltip geometry, and exported header bounds after a delayed same-origin image has decoded.

Output parity: 2,525 goldens checked; zero changed, added, missing or stale. No goldens were re-recorded. The nested-list repair and hostile-input fallback have focused tests; no committed golden contains those malformed inputs.
