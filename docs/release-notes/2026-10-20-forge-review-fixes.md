## Confluence Forge review fixes

Confluence's initial theme and later theme changes now reach the viewer settings, React Flow,
live particle rendering and caption contrast together. Platform packaging selects its attribution
policy through a typed viewer option instead of rewriting canvas source.

Attachment metadata is checked against the 8 MB limit before requesting any diagram bytes. Downloads
pin that checked version, so replacing an attachment cannot substitute a larger current version.
The viewer passes bounded JSON text directly to its adapter and validates it once. Missing saved
simulations still produce an honest error.

The configuration form preserves keyboard focus after loading and failed saves, respects focus moved
to Cancel, and fits narrow windows with long filenames. Upload coverage now saves and reopens the
new attachment ID; valid multibyte JSON exercises the exact upload byte boundary.

No parity golden changes are intended: these corrections leave the recorded diagram outputs intact.
