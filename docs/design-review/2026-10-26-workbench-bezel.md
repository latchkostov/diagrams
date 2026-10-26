## Bezel review

The switch preserves Go live and Back to editing as accessible names, with the existing Live click target and keyboard shortcut. History controls share the existing editor commands. Theme is a View submenu; explicit and system preferences are persisted separately from the effective theme. RTL uses logical history/picker spacing.

## Validation

512 targeted unit tests passed. Production build, size and i18n check passed (zero catalog errors; existing missing/stale warnings remain). Entry gzip9: 110,106 B, +1,988 B from the 108,118 B baseline, 13,394 B headroom. Viewer: 615.0 KB gzip. A real production browser smoke passed mode changes, theme selection and the common AI dock. Quick gate could not acquire the shared budget (exit 75); no passing browser SUMMARY exists for this step. The prior dock gate failures were corrected but its full affected rerun was likewise busy.

## Preserved targets and flows

live-toggle, undo-button and redo-button moved to the bezel; diagram-title now labels the picker text. theme-toggle moved to View. Nine theme specs now open View and choose or inspect an explicit radio item. Their contrast, focus, geometry and theme assertions retain their original meaning. The editor keyboard test closes the submenu before checking selection preservation. Live controls remain an overlay until step 6, so only the relocated toggle is removed from overlay avoidance now.
