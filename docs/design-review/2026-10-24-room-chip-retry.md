## Keyboard recovery

The failed room's menu retains its existing Retry action and focus handoff: the host returns to the chip, and a joiner stays on the waiting region. This adds no persistent chrome or focus effects. The two existing focus regressions retain their assertions unchanged.

The accessibility change had also hidden the menu action when trackers were absent, contradicting those recovery paths. Retain the explicit no-server explanation and file guidance, and keep the failure alerts free of ineffective Retry buttons. Restore the menu action as requested; changing the focus policy or weakening the focus assertions would not address the missing action.

## Verification

Both original focus tests fail against the pre-fix Linux build because the menu item is missing. With the fix, all 27 collab-room tests pass on Linux in each of three runs with three workers on three CPUs: 81 passed, zero failed or flaky. The original focus assertions remain unchanged.

The subsequent required sync merged the upstream tutorial runtime changes without source conflicts. Its i18n golden conflict was resolved by regeneration from the merged catalogs, then checked with zero differences across three goldens.
