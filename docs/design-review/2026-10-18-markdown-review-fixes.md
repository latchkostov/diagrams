## Markdown review fixes (#179)

The existing inspector remains the documentation editor; this round adds no global controls.
Preview text accepts wheel scrolling and click-to-edit while links retain their own activation.
Tab and Shift+Tab follow native focus order; Ctrl/Cmd+] and Ctrl/Cmd+[ indent selected lines
without deleting them. Escape saves and focuses Preview. The existing documentation badge is a
named native button with visible keyboard focus when it can open documentation, otherwise an indicator.

Imported Markdown has bounded work, combined nesting and table expansion. Budget fallbacks keep
literal text and its line breaks visible. External image sources become descriptive links under
the production CSP; the offline viewer also falls back for same-origin resources. PNG/SVG headers
use the same Markdown component and measure the rendered header. No CSP relaxation or new endpoint.
