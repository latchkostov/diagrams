## Platform snapping hints

Line-shaping tooltips and the shortcuts sheet show Command on macOS and Control
elsewhere for dragging without snapping. macOS Control-click keeps opening the
secondary-click menu. No new control is added.

Two goldens change intentionally:

- `node/i18n/catalogs.json`: the new platform-specific free-drag message adds one
  message and one English fallback per translated catalog, changing each catalog's
  shortcuts-area hash. The two existing, untranslated line-shaping hints now
  interpolate the platform modifier.
- `browser/selection/corpus-hand-shaped-lines.json`: the three route-handle titles
  say `Ctrl: no snapping` on Linux. All drawing geometry is unchanged.

All other simulation, export, language and drawing goldens match. The complete
parity run identified the three intended title differences; the selection tier was
then updated through the parity command and checked again.
