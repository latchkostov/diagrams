## Report text validation gap

Windows' default text-file encoding damaged characters in the initial Nightly deadline release note.
That note is repaired using explicit UTF-8. Prettier and the current text guard had accepted the
Unicode replacement characters left by lossy decoding.

A proposed guard extension rejecting U+FFFD catches raw and JSON-escaped replacement characters:
the new rejection regression fails with the existing guard. However, applying that extension to
all current guarded surfaces also fails on existing replacement characters in
`docs/release-notes/2026-10-23-saved-route-review.md`. The extension was not retained in the deadline
change; no existing validation assertion was weakened or skipped.

## Follow-up

Audit the guard's existing allowlisted text surfaces, recover damaged prose from history, and then
add replacement-character validation with raw and JSON-escaped regressions. Preserve any intentional
code literals through an explicitly justified rule. Use explicit UTF-8 in report-writing tools so
formatting cannot silently convert an encoding error into valid UTF-8 containing replacement glyphs.
