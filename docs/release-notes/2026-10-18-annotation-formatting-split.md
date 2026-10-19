## Annotation formatting loads separately

The inline annotation textarea remains part of the canvas and accepts typing, caret
movement, Enter, Shift+Enter, Escape and Tab immediately. Markdown shortcuts, smart
lists and indentation download when its editor opens and attach to that same textarea.
Text, focus and selection survive the download; formatting shortcuts can be ignored
until it finishes. The existing image-export header fix is unchanged.

The benchmark bundle step on the same local production configuration measures canvas
first-view gzip at **383,344 → 382,355 bytes**, saving 989 bytes with 645 bytes below
the unchanged 383,000-byte budget. The reported CI baseline was 383,326 bytes.
This falls short of the desired 1 KB headroom; unrelated loading boundaries were not
changed to achieve a larger saving.

No output goldens change intentionally; none were re-recorded.
