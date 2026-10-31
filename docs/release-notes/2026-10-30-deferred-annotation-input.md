## Annotation typing survives a pending quick-add search

Quick-add holds input after Enter while search metadata loads. It now lets the destination field interpret those keys: annotation Enter adds a newline, node Enter finishes its name, and pasted newlines follow the destination's existing rules. The buffer also keeps later typing from changing a pick that is already accepted.

Branch Nightly exposed the multiline case on macOS. Holding the metadata download reproduces both Escape and Ctrl/Command+Enter failures on Windows before the fix. The existing single-line, default-name, cancellation and React lifecycle checks remain in place. No output golden is intentionally changed.
