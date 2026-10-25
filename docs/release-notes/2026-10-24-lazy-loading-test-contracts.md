## Lazy-loading test contracts

Expanded regression coverage for recording with a held output chunk, exported SVG contents,
Retry focus ownership, cancelled late modules and editable Advanced controls after Retry.
Presentation coverage waits for fullscreen camera work to finish before resizing again.

The stronger SVG check found that awaited narration is omitted from SVG exports. Its failing
assertion is retained as a fixme with a separate backlog entry; production behavior is unchanged.
No parity goldens changed.
